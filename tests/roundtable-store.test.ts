import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Source } from "../src/lib/domain/types";
import { AppError } from "../src/lib/domain/validation";
import type { ModelJson, Roundtable } from "../src/lib/roundtable/engine";
import {
  advance,
  listRoundtables,
  postMessage,
  readRoundtable,
  startRoundtable,
} from "../src/lib/server/roundtables";

process.env.WENSHAN_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "wenshan-roundtable-")),
  "roundtables.sqlite",
);

const token = "a".repeat(64);
const otherToken = "b".repeat(64);
const sources: Source[] = [1, 2, 3, 4, 5, 6].map((id) => ({
  id,
  content_id: `zhihu:${id}`,
  title: `帖子${id}`,
  author: `作者${id}`,
  type: "answer",
  excerpt: `这是帖子${id}的摘要。`,
  url: `https://www.zhihu.com/question/1/answer/${id}`,
}));
const provider = { search: async () => sources };
function fakeTurns(prompt: string) {
  if (prompt.includes("组建一场观点圆桌"))
    return {
      opening: { content: "欢迎来到本场圆桌。" },
      issues: ["样本是否适用？"],
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
  if (prompt.includes("反方追问者")) return { content: "样本够吗？", citations: [] };
  if (prompt.includes("证据核验员")) return { content: "乙派引用最扎实。", citations: [3] };
  if (prompt.includes("背景补充员")) return { content: "补充帖子5。", citations: [5] };
  if (prompt.includes("结束一场"))
    return { content: "总结。", citations: [1], commonGround: [], disagreements: [] };
  if (prompt.includes("现场访客"))
    return {
      turns: [{ speakerRoleId: "role-1", content: "回应访客。", citations: [1] }],
    };
  return {};
}
// The model is gated so a test can hold one mutation mid-flight while another
// arrives, and switched to failing to exercise lock release.
let calls = 0;
let gate: Promise<void> | null = null;
let failing = false;
const model: ModelJson = async (prompt) => {
  calls += 1;
  if (gate) await gate;
  if (failing) throw new AppError("RATE_LIMITED", "限流", 429);
  return fakeTurns(prompt);
};
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let round: Roundtable;
test("a new roundtable reports progress and is persisted for its owner only", async () => {
  const progress: string[] = [];
  round = await startRoundtable("测试圆桌并发保护的问题", token, (message) => progress.push(message), provider, model);
  assert.equal(progress.length, 2);
  assert.equal(readRoundtable(round.id, token).id, round.id);
  await assert.rejects(async () => readRoundtable(round.id, otherToken), { code: "ROUNDTABLE_NOT_FOUND" });
});

test("concurrent mutations are refused while one holds the lock", async () => {
  const hold = deferred();
  gate = hold.promise;
  const before = calls;
  const first = advance(round.id, token, round.scheduler.turn, model);
  await new Promise((done) => setTimeout(done, 20));
  await assert.rejects(advance(round.id, token, round.scheduler.turn, model), { code: "ROUNDTABLE_BUSY" });
  await assert.rejects(postMessage(round.id, token, "我插一句", model), { code: "ROUNDTABLE_BUSY" });
  hold.resolve();
  gate = null;
  const after = await first;
  // Exactly one paid model call was made for the whole burst.
  assert.equal(calls - before, 1);
  assert.equal(after.messages.filter((m) => m.phase === "statement").length, 2);
  assert.equal(readRoundtable(round.id, token).messages.length, after.messages.length);
  round = after;
});

test("a stale expectedTurn returns the stored round without a model call", async () => {
  const before = calls;
  const same = await advance(round.id, token, 0, model);
  assert.equal(same.scheduler.turn, round.scheduler.turn);
  assert.equal(calls, before);
});

test("a failed model call releases the lock for the next attempt", async () => {
  failing = true;
  await assert.rejects(advance(round.id, token, round.scheduler.turn, model), { code: "RATE_LIMITED" });
  failing = false;
  assert.equal(readRoundtable(round.id, token).messages.length, round.messages.length, "failed attempt must not persist");
  const next = await advance(round.id, token, round.scheduler.turn, model);
  assert.ok(next.messages.length > round.messages.length);
  round = next;
});

test("visitor messages append the question and one reply", async () => {
  const replied = await postMessage(round.id, token, "我该信哪一方？", model);
  assert.equal(replied.messages.at(-2)?.speaker, "user");
  assert.equal(replied.messages.at(-1)?.speaker, "role-1");
  round = replied;
});

test("a completed roundtable no longer calls the model on advance", async () => {
  let current = round;
  for (let i = 0; i < 30 && current.scheduler.state !== "complete"; i++)
    current = await advance(round.id, token, current.scheduler.turn, model);
  assert.equal(current.scheduler.state, "complete");
  const before = calls;
  const again = await advance(round.id, token, current.scheduler.turn, model);
  assert.equal(again.messages.length, current.messages.length);
  assert.equal(calls, before);
  round = current;
});

test("listing is owner-scoped and newest first", async () => {
  await new Promise((done) => setTimeout(done, 5));
  const second = await startRoundtable("另一个用于恢复列表的问题", token, undefined, provider, model);
  const list = listRoundtables(token);
  assert.deepEqual(list.map((item) => item.id), [second.id, round.id]);
  assert.equal(list[1].state, "complete");
  assert.equal(list[1].messages, readRoundtable(round.id, token).messages.length);
  assert.equal(list[0].question, "另一个用于恢复列表的问题");
  assert.deepEqual(listRoundtables(otherToken), []);
});
