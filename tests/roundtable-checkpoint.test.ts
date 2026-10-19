import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { ModelJson, Roundtable } from "../src/lib/roundtable/engine";
import { scriptedDemoRoundtableModel } from "../src/lib/roundtable/demo";
import { db } from "../src/lib/server/store";
import { issueRoundtableCheckpoint, MAX_ROUNDTABLE_CHECKPOINT_LENGTH,
  restoreRoundtableCheckpoint } from "../src/lib/server/roundtable-checkpoint";
import { advance, completeBriefs, completeEvidence, inviteGuest, postMessage,
  readRoundtable, startRoundtable } from "../src/lib/server/roundtables";

const original = {
  WENSHAN_PUBLIC_DEMO: process.env.WENSHAN_PUBLIC_DEMO,
  WENSHAN_DB_PATH: process.env.WENSHAN_DB_PATH,
  WENSHAN_DEMO_SESSION_SECRET: process.env.WENSHAN_DEMO_SESSION_SECRET,
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
};
process.env.WENSHAN_PUBLIC_DEMO = "1";
process.env.WENSHAN_DEMO_SESSION_SECRET = "checkpoint-test-secret-do-not-use-in-deployment";
delete process.env.DEEPSEEK_API_KEY;
const directory = mkdtempSync(join(tmpdir(), "wenshan-checkpoint-"));
process.env.WENSHAN_DB_PATH = join(directory, "instance-a.sqlite");
const token = "checkpoint-visitor-" + "a".repeat(64);
const otherToken = "checkpoint-visitor-" + "b".repeat(64);
const runtime = globalThis as unknown as { tanshanDb?: DatabaseSync; tanshanRounds?: boolean; tanshanCleanup?: NodeJS.Timeout };
const connections = new Set<DatabaseSync>();
const timers = new Set<NodeJS.Timeout>();
after(() => {
  if (runtime.tanshanCleanup) timers.add(runtime.tanshanCleanup);
  for (const timer of timers) clearInterval(timer);
  for (const connection of connections) connection.close();
  delete runtime.tanshanDb;
  delete runtime.tanshanRounds;
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

function rememberConnection() {
  const connection = db();
  connections.add(connection);
  if (runtime.tanshanCleanup) timers.add(runtime.tanshanCleanup);
  return connection;
}
function removeRound(round: Roundtable) {
  rememberConnection().prepare("DELETE FROM roundtables WHERE id = ?").run(round.id);
}
function assertMissing(id: string, owner: string, checkpoint?: string) {
  assert.throws(() => readRoundtable(id, owner, checkpoint), { code: "ROUNDTABLE_NOT_FOUND" });
}
function signRaw(payload: unknown): string {
  const body = deflateSync(Buffer.from(JSON.stringify(payload))).toString("base64url");
  const key = createHmac("sha256", process.env.WENSHAN_DEMO_SESSION_SECRET!)
    .update("wenshan:demo-roundtable-checkpoint:v1").digest();
  const signature = createHmac("sha256", key).update(`v1.${body}`).digest("base64url");
  return `v1.${body}.${signature}`;
}
function unpack(checkpoint: string): { version: number; owner: string; round: Roundtable } {
  return JSON.parse(inflateSync(Buffer.from(checkpoint.split(".")[1], "base64url")).toString("utf8"));
}

test("demo checkpoints recover a lost room and continue every operation without Zhihu", async () => {
  const round = await startRoundtable("第一台相机如何按拍摄场景选择？", token);
  assert.equal(round.checkpointRevision, 0);
  assert.ok(round.checkpoint);
  assert.ok(round.checkpoint.length < MAX_ROUNDTABLE_CHECKPOINT_LENGTH);
  assert.equal(unpack(round.checkpoint).round.checkpoint, undefined);
  assert.ok(!JSON.stringify(unpack(round.checkpoint)).includes(token));
  removeRound(round);
  assertMissing(round.id, token);
  let current = readRoundtable(round.id, token, round.checkpoint);
  assert.equal(JSON.stringify(current.messages), JSON.stringify(round.messages));
  assert.equal(current.checkpointRevision, 0);
  assert.equal(current.checkpoint, round.checkpoint);

  const actions: ((room: Roundtable) => Promise<Roundtable>)[] = [
    (room) => advance(room.id, token, room.scheduler.turn, scriptedDemoRoundtableModel, room.checkpoint),
    (room) => postMessage(room.id, token, "我应该先试用什么？", scriptedDemoRoundtableModel, room.checkpoint),
    (room) => inviteGuest(room.id, token, "guest-counter", room.checkpoint),
    async (room) => { await completeBriefs(room.id, token, [], room.checkpoint); return readRoundtable(room.id, token); },
    async (room) => { await completeEvidence(room.id, token, [], room.checkpoint); return readRoundtable(room.id, token); },
  ];
  for (const action of actions) {
    removeRound(current);
    const before: number = current.checkpointRevision!;
    current = await action(current);
    assert.equal(current.checkpointRevision, before + 1);
    assert.ok(current.checkpoint);
    assert.equal(restoreRoundtableCheckpoint(current.checkpoint, current.id, token)?.checkpointRevision, before + 1);
    const saved = rememberConnection().prepare("SELECT data FROM roundtables WHERE id = ?").get(current.id) as { data: string };
    assert.equal(JSON.parse(saved.data).checkpoint, undefined, "checkpoints must not recursively persist");
  }
});

test("alternating disposable instances adopt only newer signed state", async () => {
  const created = await startRoundtable("如何把 AI 工具用进学习流程？", token);
  const instanceA = rememberConnection();
  delete runtime.tanshanDb;
  delete runtime.tanshanRounds;
  process.env.WENSHAN_DB_PATH = join(directory, "instance-b.sqlite");
  const instanceB = rememberConnection();
  const older = readRoundtable(created.id, token, created.checkpoint);
  const newer = await advance(older.id, token, older.scheduler.turn, scriptedDemoRoundtableModel, older.checkpoint);
  runtime.tanshanDb = instanceA;
  runtime.tanshanRounds = true;
  assert.equal(readRoundtable(created.id, token).messages.length, created.messages.length);
  const adopted = readRoundtable(created.id, token, newer.checkpoint);
  assert.equal(adopted.messages.length, newer.messages.length);
  assert.equal(adopted.checkpointRevision, newer.checkpointRevision);
  const next = await postMessage(created.id, token, "请补充验证方式", scriptedDemoRoundtableModel, adopted.checkpoint);
  const unchanged = readRoundtable(created.id, token, created.checkpoint);
  assert.equal(JSON.stringify(unchanged.messages), JSON.stringify(next.messages), "stale signed state must never roll back newer messages");
  assert.equal(unchanged.checkpointRevision, next.checkpointRevision);
  runtime.tanshanDb = instanceB;
  assert.equal(JSON.stringify(readRoundtable(created.id, token, next.checkpoint).messages), JSON.stringify(next.messages));
});

test("owner, round id, expiry, mode, signature and schema all fence checkpoint recovery", async () => {
  const round = await startRoundtable("如何验证转岗方向？", token);
  const checkpoint = round.checkpoint!;
  removeRound(round);
  assertMissing(round.id, otherToken, checkpoint);
  assertMissing(round.id + "-other", token, checkpoint);
  const tampered = checkpoint.slice(0, -1) + (checkpoint.endsWith("A") ? "B" : "A");
  assertMissing(round.id, token, tampered);
  assertMissing(round.id, token, "x".repeat(MAX_ROUNDTABLE_CHECKPOINT_LENGTH + 1));
  const expired = { ...round, createdAt: new Date(Date.now() - 90_000).toISOString(), expiresAt: new Date(Date.now() - 1000).toISOString() };
  assertMissing(round.id, token, issueRoundtableCheckpoint(expired, token));
  for (const transform of [
    (value: ReturnType<typeof unpack>) => ({ ...value, version: 2 }),
    (value: ReturnType<typeof unpack>) => ({ ...value, round: { ...value.round, provider: "live" } }),
    (value: ReturnType<typeof unpack>) => ({ ...value, round: { ...value.round, messages: "invalid" } }),
    (value: ReturnType<typeof unpack>) => ({ ...value, round: { ...value.round, checkpointRevision: -1 } }),
    (value: ReturnType<typeof unpack>) => ({ ...value, padding: "x".repeat(600 * 1024) }),
  ]) assertMissing(round.id, token, signRaw(transform(unpack(checkpoint))));
  process.env.WENSHAN_PUBLIC_DEMO = "0";
  try { assertMissing(round.id, token, checkpoint); }
  finally { process.env.WENSHAN_PUBLIC_DEMO = "1"; }
  const restored = readRoundtable(round.id, token, checkpoint);
  rememberConnection().prepare("UPDATE roundtables SET owner = ? WHERE id = ?").run("another-owner", round.id);
  assertMissing(round.id, token, checkpoint);
  rememberConnection().prepare("DELETE FROM roundtables WHERE id = ?").run(round.id);
  readRoundtable(restored.id, token, restored.checkpoint);
  rememberConnection().prepare("UPDATE roundtables SET expires = ? WHERE id = ?").run(Date.now() - 1, round.id);
  assertMissing(round.id, token, checkpoint);
  rememberConnection().prepare("UPDATE roundtables SET expires = ?, data = ? WHERE id = ?")
    .run(Date.parse(round.expiresAt), JSON.stringify({ ...round, provider: "live" }), round.id);
  assert.throws(() => readRoundtable(round.id, token, checkpoint), { code: "ROUNDTABLE_MODE_CHANGED" });
  process.env.WENSHAN_PUBLIC_DEMO = "0";
  try {
    const live = readRoundtable(round.id, token, checkpoint);
    assert.equal(live.provider, "live");
    assert.equal(live.checkpoint, undefined, "live rooms never expose or restore demo checkpoints");
  } finally { process.env.WENSHAN_PUBLIC_DEMO = "1"; }
});

test("a checkpoint update during generation cannot be overwritten by an older in-flight result", async () => {
  const round = await startRoundtable("第一台相机如何按拍摄场景选择？", token);
  let release!: () => void;
  let started!: () => void;
  const startedPromise = new Promise<void>((done) => { started = done; });
  const gate = new Promise<void>((done) => { release = done; });
  let calls = 0;
  const model: ModelJson = async (prompt, input) => {
    calls++; started(); await gate; return scriptedDemoRoundtableModel(prompt, input);
  };
  const pending = advance(round.id, token, round.scheduler.turn, model, round.checkpoint);
  await startedPromise;
  const remote = { ...round, checkpointRevision: 10, question: "第一台相机如何按拍摄场景选择？（已更新）" };
  const latest = readRoundtable(round.id, token, issueRoundtableCheckpoint(remote, token));
  assert.equal(latest.checkpointRevision, 10);
  release();
  await assert.rejects(pending, { code: "ROUNDTABLE_CONFLICT" });
  assert.equal(calls, 1, "the paid request must not be replayed automatically");
  assert.equal(readRoundtable(round.id, token).question, remote.question);
  assert.equal(readRoundtable(round.id, token).checkpointRevision, 10);
});

test("a stable explicit secret wins over API keys; API-key derivation and local fallback also work", async () => {
  const round = await startRoundtable("第一台相机如何按拍摄场景选择？", token);
  const secretCheckpoint = issueRoundtableCheckpoint(round, token)!;
  process.env.DEEPSEEK_API_KEY = "not-a-real-key-one";
  assert.equal(issueRoundtableCheckpoint(round, token), secretCheckpoint);
  process.env.DEEPSEEK_API_KEY = "not-a-real-key-two";
  assert.ok(restoreRoundtableCheckpoint(secretCheckpoint, round.id, token));
  delete process.env.WENSHAN_DEMO_SESSION_SECRET;
  const apiCheckpoint = issueRoundtableCheckpoint(round, token)!;
  assert.equal(issueRoundtableCheckpoint(round, token), apiCheckpoint);
  assert.ok(restoreRoundtableCheckpoint(apiCheckpoint, round.id, token));
  process.env.DEEPSEEK_API_KEY = "not-a-real-key-three";
  assert.equal(restoreRoundtableCheckpoint(apiCheckpoint, round.id, token), undefined);
  delete process.env.DEEPSEEK_API_KEY;
  const localCheckpoint = issueRoundtableCheckpoint(round, token)!;
  assert.equal(issueRoundtableCheckpoint(round, token), localCheckpoint);
  assert.ok(restoreRoundtableCheckpoint(localCheckpoint, round.id, token));
  process.env.WENSHAN_DEMO_SESSION_SECRET = "checkpoint-test-secret-do-not-use-in-deployment";
  assert.equal(restoreRoundtableCheckpoint(localCheckpoint, round.id, token), undefined);
  assert.ok(restoreRoundtableCheckpoint(secretCheckpoint, round.id, token));
});

test("normal maximum-length discussions fit; oversized optional history preserves the paid result without a checkpoint", async () => {
  const round = await startRoundtable("第一台相机如何按拍摄场景选择？", token);
  const large = { ...round, messages: Array.from({ length: 24 }, (_, index) => ({
    ...round.messages[0], id: `long-message-${index}`, order: index,
    content: randomBytes(1500).toString("base64"),
  })) };
  const checkpoint = issueRoundtableCheckpoint(large, token);
  assert.ok(checkpoint);
  assert.equal(restoreRoundtableCheckpoint(checkpoint, round.id, token)?.messages.length, 24);

  const oversize = { ...large, messages: Array.from({ length: 90 }, (_, index) => ({
    ...large.messages[0], id: `very-long-message-${index}`, order: index,
    content: "长对话内容".repeat(1000),
  })) };
  assert.equal(issueRoundtableCheckpoint(oversize, token), undefined);
  rememberConnection().prepare("UPDATE roundtables SET data = ? WHERE id = ?").run(JSON.stringify(oversize), round.id);
  let calls = 0;
  const model: ModelJson = async (prompt, input) => { calls++; return scriptedDemoRoundtableModel(prompt, input); };
  const result = await postMessage(round.id, token, "这是最后一个问题", model);
  assert.equal(calls, 1);
  assert.ok(result.messages.some((message) => message.content === "这是最后一个问题"));
  assert.equal(result.checkpoint, undefined);
  assert.equal(readRoundtable(round.id, token).messages.length, result.messages.length);
});
