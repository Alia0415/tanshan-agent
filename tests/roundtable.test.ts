import test from "node:test";
import assert from "node:assert/strict";
import type { Source } from "../src/lib/domain/types";
import {
  advanceRoundtable,
  createRoundtable,
  joinUser,
  type ModelJson,
  type Roundtable,
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

test("guests interject between exchange pairs in order", async () => {
  const round = await bootstrap(fakeTurns);
  await advanceRoundtable(round, sources, fakeTurns); // statements
  await advanceRoundtable(round, sources, fakeTurns); // pair 1
  await advanceRoundtable(round, sources, fakeTurns); // pair 2
  const guest = round.messages.find((m) => m.speaker === "guest-counter");
  assert.ok(guest, "counter guest should interject after two pairs");
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
  // All three guests spoke exactly once.
  for (const guest of ["guest-counter", "guest-evidence", "guest-context"])
    assert.equal(round.messages.filter((m) => m.speaker === guest).length, 1);
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

test("invalid citations fall back to the role's own sources", async () => {
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
  assert.deepEqual(statement.citations, [1, 2].slice(0, 2));
});
