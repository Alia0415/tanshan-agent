import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { choicesForTag, revisionChoices } from "../src/lib/server/revision-choices";
import { createSession, clarify, updateContext, claimAnswer, runAnswer } from "../src/lib/server/sessions";
import { getSession, saveSession } from "../src/lib/server/store";
process.env.WENSHAN_DB_PATH = join(mkdtempSync(join(tmpdir(), "tanshan-choices-")), "sessions.sqlite");
process.env.WENSHAN_PROVIDER = "live";
process.env.WENSHAN_SEARCH_MODE = "basic";
process.env.DEEPSEEK_API_KEY = "test-only";
const owner = "choices-tests";
async function legacy() {
  const first = await createSession("买相机怎么选？", owner, async () => ({
    kind: "contextual", title: "主要拍什么？", description: "用途", fields: [], options: ["风光", "人像"], selection_mode: "single",
  }));
  const result = await clarify(first.session.session_id, owner, { context_version: 1, selections: {}, answer: "风光", skip: false }, async () => undefined);
  const session = result.session;
  session.clarification_history = [{ question: "主要拍什么？", answer: "风光" }];
  saveSession(session); return session;
}
const response = () => Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ options: ["风光", "人像", "运动"], selection_mode: "single" }) } }] });
test("legacy options generate once, persist, and selected replacement reaches a new search", async (t) => {
  const session = await legacy();
  const mock = t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const data = JSON.parse(JSON.parse(init.body as string).messages[1].content);
    assert.deepEqual(data, { original_question: "买相机怎么选？", question: "主要拍什么？", current_answer: "风光" });
    return response();
  });
  const args = [session.session_id, owner, session.context_version, 0] as const;
  const [a, b] = await Promise.all([revisionChoices(...args), revisionChoices(...args)]);
  assert.deepEqual(a, b); assert.equal(mock.mock.callCount(), 1);
  await revisionChoices(...args); assert.equal(mock.mock.callCount(), 1);
  assert.equal(getSession(session.session_id, owner).context_version, session.context_version);
  const next = updateContext(session.session_id, owner, { context_version: session.context_version, changes: {}, clarification_revision: { history_index: 0, selected: ["人像"] } }).session;
  const queries: string[] = [];
  const request = randomUUID(); claimAnswer(next.session_id, owner, next.context_version, request);
  await runAnswer(next.session_id, next.context_version, request, {
    search: async (query) => { queries.push(query); return [{ id: 1, content_id: "test", title: "人像拍摄", author: "测试", type: "answer", url: "https://www.zhihu.com/question/1/answer/2", excerpt: "人像拍摄经验" }]; },
    generate: async () => ({ summary: "测试总结", summary_citations: [1], sections: [], limitations: [] }),
  });
  assert.ok(queries.length > 0);
  assert.ok(queries.every((query) => query.includes("人像") && !query.includes("风光")));
  assert.equal(getSession(next.session_id, owner).stage, "completed");
});
test("invalid generation leaves history intact and a retry can succeed", async (t) => {
  const session = await legacy(); let attempts = 0;
  t.mock.method(globalThis, "fetch", async () => ++attempts === 1
    ? Response.json({ choices: [{ finish_reason: "stop", message: { content: "{}" } }] }) : response());
  await assert.rejects(revisionChoices(session.session_id, owner, session.context_version, 0));
  assert.equal(getSession(session.session_id, owner).clarification_history?.[0].card, undefined);
  await revisionChoices(session.session_id, owner, session.context_version, 0);
  assert.equal(attempts, 2);
});
test("a late generation cannot overwrite newer conditions", async (t) => {
  const session = await legacy();
  t.mock.method(globalThis, "fetch", async () => {
    updateContext(session.session_id, owner, { context_version: session.context_version, changes: {}, free_text: "最新需求" });
    return response();
  });
  await assert.rejects(revisionChoices(session.session_id, owner, session.context_version, 0));
  assert.equal(getSession(session.session_id, owner).clarification_history?.[0].card, undefined);
});


test("a summarized label automatically resolves its source among multiple questions and caches the mapping", async (t) => {
  const session = await legacy();
  session.original_question = "非技术背景想转行AI，怎么开始？";
  session.clarification_history = [
    { question: "你目前与AI的接触经历？", answer: "工作中用过AI工具但不了解原理", card: { kind: "contextual", fields: [], title: "你目前与AI的接触经历？", description: "", options: ["尚未接触AI", "工作中用过AI工具但不了解原理", "有AI开发经验"], selection_mode: "single" } },
    { question: "想从事哪类AI工作？", answer: "产品运营", card: { kind: "contextual", fields: [], title: "想从事哪类AI工作？", description: "", options: ["产品运营", "算法研发", "业务提效"], selection_mode: "single" } },
  ];
  session.free_text_context = session.clarification_history.map((turn) => "关于「" + turn.question + "」：" + turn.answer);
  const answerId = randomUUID();
  session.answers = [{ id: answerId, context_version: session.context_version, context: session.confirmed_context,
    focused_question: session.original_question, condition_tags: ["非技术背景", "转行AI产品运营"],
    summary: "", summary_citations: [], sections: [], limitations: [], sources: [], queries: [], evidence: "sources", created_at: new Date().toISOString() }];
  saveSession(session);
  const mock = t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const input = JSON.parse(JSON.parse(init.body as string).messages[1].content);
    assert.equal(input.label, "非技术背景"); assert.equal(input.history.length, 2);
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ history_index: 0 }) } }] });
  });
  const result = await choicesForTag(session.session_id, owner, session.context_version, answerId, "非技术背景");
  assert.equal(result.history_index, 0);
  assert.deepEqual(result.card.options, ["尚未接触AI", "工作中用过AI工具但不了解原理", "有AI开发经验"]);
  await choicesForTag(session.session_id, owner, session.context_version, answerId, "非技术背景");
  assert.equal(mock.mock.callCount(), 1, "cached provenance avoids another model call");
  const updated = updateContext(session.session_id, owner, { context_version: session.context_version, changes: {}, clarification_revision: { history_index: result.history_index, selected: ["有AI开发经验"] } }).session;
  assert.equal(updated.clarification_history?.[0].answer, "有AI开发经验");
  assert.equal(updated.clarification_history?.[1].answer, "产品运营");
});
