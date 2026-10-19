import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEMO_TOPICS } from "../src/lib/reading/demo";
import { scriptedDemoRoundtableModel } from "../src/lib/roundtable/demo";
import {
  EXCHANGE_PAIR_PROMPT, GUEST_PROMPTS, ROSTER_PROMPT,
  STATEMENTS_PROMPT, SUMMARY_PROMPT, USER_REPLY_PROMPT,
} from "../src/lib/roundtable/prompts";
import { db } from "../src/lib/server/store";
import {
  advance, completeBriefs, completeEvidence, inviteGuest, listRoundtables,
  postMessage, readRoundtable, startRoundtable,
} from "../src/lib/server/roundtables";

const originalFetch = globalThis.fetch;
const originalEnv = {
  WENSHAN_PUBLIC_DEMO: process.env.WENSHAN_PUBLIC_DEMO,
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
  ZHIHU_ACCESS_SECRET: process.env.ZHIHU_ACCESS_SECRET,
  WENSHAN_DB_PATH: process.env.WENSHAN_DB_PATH,
};
process.env.WENSHAN_DB_PATH = join(mkdtempSync(join(tmpdir(), "wenshan-demo-round-")), "test.sqlite");
process.env.WENSHAN_PUBLIC_DEMO = "1";
process.env.ZHIHU_ACCESS_SECRET = "expired-test-credential";
const token = "c".repeat(64);
after(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("demo scripts complete all supported topics without accessing either API", async () => {
  delete process.env.DEEPSEEK_API_KEY;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("No network allowed"); };
  const provider = { search: async () => { throw new Error("No Zhihu search allowed"); } };
  for (const topic of DEMO_TOPICS) {
    const progress: string[] = [];
    let round = await startRoundtable(topic.title, token, (message) => progress.push(message), provider);
    assert.equal(round.provider, "demo");
    assert.equal(round.model, "local-demo-script");
    assert.ok(progress[0].includes("未检索知乎"));
    assert.ok(round.sources.every((source) => source.url.startsWith("/demo#") && source.type === "原创示例"));
    round = await advance(round.id, token, round.scheduler.turn);
    round = await postMessage(round.id, token, "如果我的情况与示例不同，应该先验证什么？");
    assert.equal(round.messages.at(-2)?.speaker, "user");
    assert.equal(round.messages.at(-1)?.replyTo, round.messages.at(-2)?.id);
    for (const guest of Object.keys(GUEST_PROMPTS)) round = await inviteGuest(round.id, token, guest);
    assert.equal(round.joinedGuestIds?.length, 3);

    // Simulate an older saved sample without the optional inline summaries.
    const message = round.messages.find((item) => item.phase === "statement")!;
    delete message.brief;
    delete message.summary;
    delete message.evidencePoints;
    db().prepare("UPDATE roundtables SET data = ? WHERE id = ?").run(JSON.stringify(round), round.id);
    const briefs = await completeBriefs(round.id, token, [message.id]);
    const points = await completeEvidence(round.id, token, [message.id]);
    assert.ok(briefs[message.id].length <= 40);
    assert.ok(points[message.id].every((point) => point.length <= 60));
    for (let i = 0; i < 15 && round.scheduler.state !== "complete"; i++)
      round = await advance(round.id, token);
    assert.equal(round.scheduler.state, "complete");
    assert.equal(round.messages.at(-1)?.phase, "summary");
    assert.ok(round.roles.every((role) => role.name.includes("示例")));
    assert.ok(round.messages.filter((item) => item.speaker !== "user").every((item) => item.content.startsWith("【原创示例")));
  }
  await assert.rejects(startRoundtable("一个完全不在样例中的问题", token), { code: "DEMO_TOPIC_REQUIRED" });
  assert.equal(requests, 0);
});

function originalPrompt(instructions: string): string {
  if (instructions.includes("组建一场观点圆桌")) return ROSTER_PROMPT;
  if (instructions.includes("观点陈述环节")) return STATEMENTS_PROMPT;
  if (instructions.includes("两段连续交锋")) return EXCHANGE_PAIR_PROMPT;
  if (instructions.includes("现场访客刚刚发言")) return USER_REPLY_PROMPT;
  if (instructions.includes("要结束一场")) return SUMMARY_PROMPT;
  for (const [id, prompt] of Object.entries(GUEST_PROMPTS)) {
    const name = id === "guest-counter" ? "反方追问者" : id === "guest-evidence" ? "证据核验员" : "背景补充员";
    if (instructions.includes(`你是圆桌的${name}`)) return prompt;
  }
  return instructions;
}

test("configured AI demo routes generation, guests and summaries only to DeepSeek", async () => {
  process.env.DEEPSEEK_API_KEY = "not-a-real-key";
  const requests: string[] = [];
  globalThis.fetch = async (url, options) => {
    requests.push(String(url));
    assert.equal(new URL(String(url)).hostname, "api.deepseek.com");
    const body = JSON.parse(String(options?.body)) as { messages: { role: string; content: string }[] };
    const instructions = body.messages[0].content;
    assert.match(instructions, /非知乎检索结果/);
    const result = await scriptedDemoRoundtableModel(originalPrompt(instructions), JSON.parse(body.messages[1].content));
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(result) } }] });
  };
  let round = await startRoundtable("如何把 AI 工具用进学习流程？", token);
  assert.notEqual(round.model, "local-demo-script");
  round = await advance(round.id, token);
  round = await postMessage(round.id, token, "怎样核实学习资料？");
  for (const guest of Object.keys(GUEST_PROMPTS)) round = await inviteGuest(round.id, token, guest);
  const message = round.messages[1];
  delete message.brief;
  delete message.summary;
  delete message.evidencePoints;
  db().prepare("UPDATE roundtables SET data = ? WHERE id = ?").run(JSON.stringify(round), round.id);
  await completeBriefs(round.id, token, [message.id]);
  await completeEvidence(round.id, token, [message.id]);
  for (let i = 0; i < 15 && round.scheduler.state !== "complete"; i++) round = await advance(round.id, token);
  assert.equal(round.scheduler.state, "complete");
  assert.ok(requests.length >= 10);
});

test("switching modes fences old rooms before any model or search request", async () => {
  delete process.env.DEEPSEEK_API_KEY;
  globalThis.fetch = async () => { throw new Error("No network allowed"); };
  const round = await startRoundtable("如何验证转岗方向？", token);
  const oldLive = { ...round, id: `${round.id}-old-live`, provider: "live" };
  db().prepare("INSERT INTO roundtables SELECT ?, owner, expires, ? FROM roundtables WHERE id = ?")
    .run(oldLive.id, JSON.stringify(oldLive), round.id);
  assert.equal(listRoundtables(token).some((item) => item.id === oldLive.id), false);
  assert.throws(() => readRoundtable(oldLive.id, token), { code: "ROUNDTABLE_MODE_CHANGED" });
  for (const action of [
    () => advance(oldLive.id, token), () => postMessage(oldLive.id, token, "插话"),
    () => inviteGuest(oldLive.id, token, "guest-counter"),
    () => completeBriefs(oldLive.id, token, []), () => completeEvidence(oldLive.id, token, []),
  ]) await assert.rejects(action(), { code: "ROUNDTABLE_MODE_CHANGED" });
  process.env.WENSHAN_PUBLIC_DEMO = "0";
  try {
    assert.throws(() => readRoundtable(round.id, token), { code: "ROUNDTABLE_MODE_CHANGED" });
    assert.equal(listRoundtables(token).some((item) => item.id === round.id), false);
  } finally {
    process.env.WENSHAN_PUBLIC_DEMO = "1";
  }
});
