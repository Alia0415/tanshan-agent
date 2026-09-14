import test from "node:test";
import assert from "node:assert/strict";
import type { Source } from "../src/lib/domain/types";
import {
  advanceRoundtable,
  createRoundtable,
  joinUser,
  joinGuest,
  type ModelJson,
} from "../src/lib/roundtable/engine";

const sources: Source[] = [1, 2, 3, 4, 5, 6].map((id) => ({
  id,
  content_id: `zhihu:${id}`,
  title: `帖子${id}`,
  author: `作者${id}`,
  type: "answer",
  excerpt: `这是帖子${id}的摘要。`,
  url: `https://www.zhihu.com/question/1/answer/${id}`,
}));
const fakeTurns: ModelJson = async (prompt) => {
  if (prompt.includes("组建一场观点圆桌"))
    return {
      opening: { content: "欢迎来到本场圆桌，先请各位陈述观点。" },
      issues: ["样本是否适用？", "结论是否充分？"],
      roles: [
        { name: "甲派", description: "只依据帖子1、2", sourceIds: [1, 2] },
        { name: "乙派", description: "只依据帖子3、4", sourceIds: [3, 4] },
      ],
    };
  if (prompt.includes("观点陈述"))
    return {
      turns: [
        { speakerRoleId: "role-1", content: "甲派陈述。", citations: [1] },
        { speakerRoleId: "role-2", content: "乙派陈述。", citations: [3] },
      ],
    };
  if (prompt.includes("两段连续交锋"))
    return {
      turns: [
        { speakerRoleId: "role-1", content: "甲派反驳。", citations: [2] },
        { speakerRoleId: "role-2", content: "乙派回应。", replyToMessageId: "first-turn", citations: [4] },
      ],
    };
  if (prompt.includes("反方追问者")) return { content: "你们甲派的样本够吗？", citations: [] };
  if (prompt.includes("证据核验员")) return { content: "乙派引用最扎实。", citations: [3] };
  if (prompt.includes("背景补充员")) return { content: "补充帖子5的背景。", citations: [5] };
  if (prompt.includes("结束一场"))
    return {
      content: "本场共识有限，分歧在样本。",
      citations: [1],
      commonGround: ["都重视样本"],
      disagreements: ["对结论的确定性不同"],
    };
  if (prompt.includes("现场访客"))
    return {
      turns: [
        { speakerRoleId: "role-1", content: "回应访客。", replyToMessageId: "REPLY", citations: [1] },
      ],
    };
  return {};
};

async function bootstrap(model: ModelJson) {
  return createRoundtable("round-t", "测试问题", sources, model, "test");
}

test("roster rejects roles without usable sources", async () => {
  const bad: ModelJson = async () => ({
    opening: { content: "开场" },
    roles: [
      { name: "甲", description: "无有效来源", sourceIds: [99] },
      { name: "乙", description: "正常", sourceIds: [1] },
    ],
  });
  await assert.rejects(bootstrap(bad), { code: "INSUFFICIENT_VIEWS" });
});

test("statements batch into one call and dedupe speakers", async () => {
  const round = await bootstrap(fakeTurns);
  await advanceRoundtable(round, sources, fakeTurns);
  assert.equal(round.messages.filter((m) => m.phase === "statement").length, 2);
  // Duplicate statement turns are dropped, not duplicated.
  await advanceRoundtable(round, sources, fakeTurns);
  assert.equal(round.messages.filter((m) => m.phase === "statement").length, 2);
});

test("only a manually joined guest speaks", async () => {
  const round = await bootstrap(fakeTurns);
  await advanceRoundtable(round, sources, fakeTurns); // statements
  await advanceRoundtable(round, sources, fakeTurns); // pair 1
  await advanceRoundtable(round, sources, fakeTurns); // pair 2
  assert.equal(round.messages.some((m) => m.speaker.startsWith("guest-")), false);
  await joinGuest(round, sources, fakeTurns, "guest-counter");
  await joinGuest(round, sources, fakeTurns, "guest-counter");
  assert.deepEqual(round.joinedGuestIds, ["guest-counter"]);
  assert.equal(round.messages.filter((m) => m.speaker === "guest-counter").length, 1);
  const guest = round.messages.find((m) => m.speaker === "guest-counter");
  assert.ok(guest, "counter guest should speak after being dropped");
  assert.equal(guest.replyTo, round.messages[round.messages.length - 2].id);
});

test("pair citations stay inside each speaker base and link replies", async () => {
  const round = await bootstrap(fakeTurns);
  await advanceRoundtable(round, sources, fakeTurns);
  await advanceRoundtable(round, sources, fakeTurns);
  const pair = round.messages.filter((m) => m.phase === "exchange");
  assert.equal(pair.length, 2);
  assert.equal(pair[1].replyTo, pair[0].id);
  assert.deepEqual(pair[0].citations, [2]);
  assert.deepEqual(pair[1].citations, [4]);
});

test("summary only after enough viewpoint exchanges", async () => {
  const round = await bootstrap(fakeTurns);
  for (let i = 0; i < 20 && round.scheduler.state !== "complete"; i++)
    await advanceRoundtable(round, sources, fakeTurns);
  assert.equal(round.scheduler.state, "complete");
  const summary = round.messages.at(-1)!;
  assert.equal(summary.phase, "summary");
  assert.equal(summary.speaker, "host");
  const viewpointExchanges = round.messages.filter(
    (m) => m.phase === "exchange" && m.speaker.startsWith("role-"),
  ).length;
  assert.ok(viewpointExchanges >= 8);
  // No library guest is invoked automatically.
  for (const guest of ["guest-counter", "guest-evidence", "guest-context"])
    assert.equal(round.messages.filter((m) => m.speaker === guest).length, 0);
  // No further advance after completion.
  assert.equal(await advanceRoundtable(round, sources, fakeTurns), false);
});

test("visitor message is answered by one viewpoint agent", async () => {
  const round = await bootstrap(fakeTurns);
  await advanceRoundtable(round, sources, fakeTurns);
  await joinUser(round, sources, fakeTurns, "我该相信哪一方？");
  const user = round.messages.find((m) => m.phase === "user")!;
  assert.equal(user.speaker, "user");
  const reply = round.messages.at(-1)!;
  assert.equal(reply.speaker, "role-1");
  assert.equal(reply.replyTo, user.id);
});

test("invalid citations never fabricate source support", async () => {
  const lying: ModelJson = async (prompt) => {
    if (prompt.includes("观点陈述"))
      return {
        turns: [
          { speakerRoleId: "role-1", content: "甲派陈述。", citations: [3, 99] },
          { speakerRoleId: "role-2", content: "乙派陈述。", citations: [4] },
        ],
      };
    return fakeTurns(prompt, null);
  };
  const round = await bootstrap(lying);
  await advanceRoundtable(round, sources, lying);
  const statement = round.messages.find((m) => m.phase === "statement" && m.speaker === "role-1")!;
  // Citation 3 belongs to the rival base and must not survive.
  assert.deepEqual(statement.citations, []);
});


test("brief summaries survive generation without another model call", async () => {
  let calls = 0;
  const model: ModelJson = async (prompt, payload) => {
    calls++;
    const output = await fakeTurns(prompt, payload) as { opening?: { content: string; summary?: string }; turns?: { summary?: string }[] };
    if (output.opening) output.opening.summary = "主持人摘要";
    for (const turn of output.turns ?? []) turn.summary = "观点摘要";
    return output;
  };
  const round = await bootstrap(model);
  assert.equal(round.messages[0].summary, "主持人摘要");
  await advanceRoundtable(round, sources, model);
  assert.equal(calls, 2);
  assert.equal(round.messages[1].summary, "观点摘要");
  assert.equal(round.messages[1].content, "甲派陈述。");
});

test("invalid brief does not discard a valid full statement", async () => {
  const round = await bootstrap(fakeTurns);
  await advanceRoundtable(round, sources, async () => ({ turns: [
    { speakerRoleId: "role-1", content: "完整观点", summary: "字".repeat(91), citations: [1] },
  ] }));
  assert.equal(round.messages.at(-1)?.content, "完整观点");
  assert.equal(round.messages.at(-1)?.summary, undefined);
});


test("structured takeaway preserves claim and evidence alongside the full argument", async () => {
  let calls = 0;
  const brief = { claim: "读博应以研究兴趣为前提", evidence: "帖子1描述了长期科研投入带来的压力[1]" };
  const model: ModelJson = async (prompt, payload) => {
    calls++;
    const output = await fakeTurns(prompt, payload) as { opening?: { brief?: typeof brief }; turns?: { brief?: typeof brief }[] };
    if (output.opening) output.opening.brief = brief;
    for (const turn of output.turns ?? []) turn.brief = brief;
    return output;
  };
  const round = await bootstrap(model);
  assert.equal(round.messages[0].brief?.claim, brief.claim);
  await advanceRoundtable(round, sources, model);
  assert.deepEqual(round.messages[1].brief, brief);
  assert.equal(round.messages[1].content, "甲派陈述。");
  assert.equal(calls, 2);
});

test("incomplete takeaway never masquerades as a supported viewpoint", async () => {
  const round = await bootstrap(fakeTurns);
  await advanceRoundtable(round, sources, async () => ({ turns: [
    { speakerRoleId: "role-1", content: "完整论证", brief: { claim: "观点", evidence: " " }, citations: [1] },
  ] }));
  assert.equal(round.messages.at(-1)?.brief, undefined);
  assert.equal(round.messages.at(-1)?.content, "完整论证");
});

test("each dropped guest speaks, including after completion, and unknown guests are rejected", async () => {
  const round = await bootstrap(fakeTurns);
  while (round.scheduler.state !== "complete") await advanceRoundtable(round, sources, fakeTurns);
  for (const id of ["guest-evidence", "guest-context", "guest-counter"]) {
    await joinGuest(round, sources, fakeTurns, id);
    assert.equal(round.messages.at(-1)?.speaker, id);
  }
  assert.equal(round.scheduler.state, "complete");
  await assert.rejects(joinGuest(round, sources, fakeTurns, "unknown"), { code: "INVALID_GUEST" });
});

test("failed guest generation does not mark it joined", async () => {
  const round = await bootstrap(fakeTurns);
  await assert.rejects(joinGuest(round, sources, async () => ({}), "guest-evidence"));
  assert.deepEqual(round.joinedGuestIds, []);
  await joinGuest(round, sources, fakeTurns, "guest-evidence");
  assert.deepEqual(round.joinedGuestIds, ["guest-evidence"]);
});


test("issue agenda focuses each pair and allows evidence gaps to end early", async () => {
  const round = await bootstrap(fakeTurns);
  round.issues = [
    { id: "a", question: "样本是否适用？", state: "open", attempts: 0 },
    { id: "b", question: "成本是否值得？", state: "open", attempts: 0 },
  ];
  await advanceRoundtable(round, sources, fakeTurns);
  const seen: string[] = [];
  const model: ModelJson = async (prompt, payload) => {
    if (prompt.includes("两段连续交锋")) {
      const input = payload as { activeIssue: { id: string } };
      seen.push(input.activeIssue.id);
      return { ...await fakeTurns(prompt, payload) as object,
        progress: { issueId: input.activeIssue.id, state: "needs_evidence", reason: "缺少代表性样本" } };
    }
    return fakeTurns(prompt, payload);
  };
  await advanceRoundtable(round, sources, model);
  await advanceRoundtable(round, sources, model);
  await advanceRoundtable(round, sources, model);
  assert.deepEqual(seen, ["a", "b"]);
  assert.equal(round.scheduler.state, "complete");
  assert.equal(round.issues[0].state, "needs_evidence");
  assert.equal(round.messages.filter(m => m.phase === "exchange").length, 4);
});

test("missing progress is bounded and cannot invent consensus", async () => {
  const round = await bootstrap(fakeTurns);
  round.issues = [{ id: "a", question: "是否适用？", state: "open", attempts: 0 }];
  await advanceRoundtable(round, sources, fakeTurns);
  await advanceRoundtable(round, sources, fakeTurns);
  assert.equal(round.issues[0].state, "open");
  await advanceRoundtable(round, sources, fakeTurns);
  assert.equal(round.issues[0].state, "stalled");
  await advanceRoundtable(round, sources, fakeTurns);
  assert.equal(round.scheduler.state, "complete");
});

test("duplicate pair speakers cannot resolve an issue", async () => {
  const round = await bootstrap(fakeTurns);
  round.issues = [{ id: "a", question: "是否适用？", state: "open", attempts: 0 }];
  await advanceRoundtable(round, sources, fakeTurns);
  await advanceRoundtable(round, sources, async () => ({
    turns: [1, 2].map(() => ({ speakerRoleId: "role-1", content: "观点", citations: [1] })),
    progress: { issueId: "a", state: "resolved", reason: "一致" },
  }));
  assert.equal(round.messages.filter(m => m.phase === "exchange").length, 1);
  assert.equal(round.issues[0].state, "open");
});

test("invalid inline citations and guest fallback are removed", async () => {
  const round = await bootstrap(fakeTurns);
  await advanceRoundtable(round, sources, async () => ({ turns: [{
    speakerRoleId: "role-1", content: "说法[99]和[3]及[1]", citations: [1, 99],
    brief: { claim: "说法[99]", evidence: "理由[3]", evidencePoints: ["依据[99]"] },
  }] }));
  const message = round.messages.at(-1)!;
  assert.equal(message.content, "说法和及[1]");
  assert.equal(message.brief?.evidence, "理由");
  await joinGuest(round, sources, async () => ({ content: "未核实[99]", citations: [99] }), "guest-evidence");
  assert.deepEqual(round.messages.at(-1)?.citations, []);
  assert.equal(round.messages.at(-1)?.content, "未核实");
});
