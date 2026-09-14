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
import { db, ownerHash } from "../src/lib/server/store";

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
// arrives, and switched to failing to exercise slot release.
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
let seq = 0;
const control = (revision: number) => ({ requestId: `req-${++seq}-${"x".repeat(8)}`, revision });

let round: Roundtable;
test("a new roundtable starts at revision 0 and is persisted", async () => {
  round = await startRoundtable("测试圆桌并发保护的问题", token, provider, model);
  assert.equal(round.revision, 0);
  assert.equal(readRoundtable(round.id, token).revision, 0);
});

test("concurrent mutations are refused while one is running", async () => {
  const hold = deferred();
  gate = hold.promise;
  const before = calls;
  const first = advance(round.id, token, control(0), model);
  await assert.rejects(advance(round.id, token, control(0), model), { code: "ROUND_BUSY" });
  await assert.rejects(
    postMessage(round.id, token, "我插一句", control(0), model),
    { code: "ROUND_BUSY" },
  );
  hold.resolve();
  gate = null;
  const after = await first;
  // Exactly one paid model call was made for the whole burst.
  assert.equal(calls - before, 1);
  assert.equal(after.revision, 1);
  assert.equal(after.messages.filter((m) => m.phase === "statement").length, 2);
  assert.equal(readRoundtable(round.id, token).revision, 1);
});

test("a stale revision is refused before any model call", async () => {
  const before = calls;
  await assert.rejects(advance(round.id, token, control(0), model), { code: "ROUND_UPDATED" });
  await assert.rejects(
    postMessage(round.id, token, "旧版本发言", control(0), model),
    { code: "ROUND_UPDATED" },
  );
  assert.equal(calls, before);
});

test("a failed model call releases the slot and is never replayed for the same request id", async () => {
  failing = true;
  const request = control(1);
  await assert.rejects(advance(round.id, token, request, model), { code: "RATE_LIMITED" });
  failing = false;
  assert.equal(readRoundtable(round.id, token).revision, 1, "failed attempt must not persist");
  const before = calls;
  const replay = await advance(round.id, token, request, model);
  assert.equal(replay.revision, 1);
  assert.equal(calls, before, "same request id returns the stored round without a model call");
  const fresh = await advance(round.id, token, control(1), model);
  assert.equal(fresh.revision, 2);
  assert.equal(calls, before + 1);
});

test("visitor messages bump the revision and are refused while a turn is running", async () => {
  let current = readRoundtable(round.id, token);
  const replied = await postMessage(round.id, token, "我该信哪一方？", control(current.revision), model);
  assert.equal(replied.revision, current.revision + 1);
  assert.equal(replied.messages.at(-2)?.speaker, "user");
  assert.equal(replied.messages.at(-1)?.speaker, "role-1");
  current = replied;
  const hold = deferred();
  gate = hold.promise;
  const pending = postMessage(round.id, token, "再问一句", control(current.revision), model);
  await assert.rejects(advance(round.id, token, control(current.revision), model), { code: "ROUND_BUSY" });
  hold.resolve();
  gate = null;
  assert.equal((await pending).revision, current.revision + 1);
});

test("a completed roundtable releases the slot without calling the model", async () => {
  let current = readRoundtable(round.id, token);
  for (let i = 0; i < 30 && current.scheduler.state !== "complete"; i++)
    current = await advance(round.id, token, control(current.revision), model);
  assert.equal(current.scheduler.state, "complete");
  const before = calls;
  const again = await advance(round.id, token, control(current.revision), model);
  assert.equal(again.revision, current.revision);
  assert.equal(calls, before);
  // The slot was released, so the visitor can still speak afterwards.
  const spoken = await postMessage(round.id, token, "总结后再问", control(current.revision), model);
  assert.equal(spoken.revision, current.revision + 1);
});

test("listing is owner-scoped and newest first", async () => {
  await new Promise((done) => setTimeout(done, 5));
  const second = await startRoundtable("另一个用于恢复列表的问题", token, provider, model);
  const list = listRoundtables(token);
  assert.deepEqual(
    list.map((item) => item.id),
    [second.id, round.id],
  );
  assert.equal(list[1].state, "complete");
  assert.equal(list[1].messages, readRoundtable(round.id, token).messages.length);
  assert.equal(list[0].question, "另一个用于恢复列表的问题");
  assert.deepEqual(listRoundtables(otherToken), []);
  await assert.rejects(
    async () => readRoundtable(round.id, otherToken),
    { code: "ROUNDTABLE_NOT_FOUND" },
  );
});

test("rows written before optimistic locking load as revision 0", async () => {
  const legacy = structuredClone(round) as Partial<Roundtable>;
  legacy.id = "round-legacy";
  delete legacy.revision;
  db()
    .prepare("INSERT INTO roundtables (id, owner, expires, data) VALUES (?, ?, ?, ?)")
    .run("round-legacy", ownerHash(token), Date.parse(round.expiresAt), JSON.stringify(legacy));
  assert.equal(readRoundtable("round-legacy", token).revision, 0);
  const advanced = await advance("round-legacy", token, control(0), model);
  assert.equal(advanced.revision, 1);
});

test("a restarted process frees slots the previous one left running", async () => {
  db()
    .prepare("INSERT INTO round_requests VALUES (?, 'stuck-request', 'running')")
    .run("round-legacy");
  await assert.rejects(advance("round-legacy", token, control(1), model), { code: "ROUND_BUSY" });
  (globalThis as { wenshanRounds?: boolean }).wenshanRounds = false;
  listRoundtables(token);
  const status = db()
    .prepare("SELECT status FROM round_requests WHERE request_id = 'stuck-request'")
    .get() as { status: string };
  assert.equal(status.status, "interrupted");
  const resumed = await advance("round-legacy", token, control(1), model);
  assert.equal(resumed.revision, 2);
});
