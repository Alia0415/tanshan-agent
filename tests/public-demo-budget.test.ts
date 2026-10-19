import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { AppError } from "../src/lib/domain/validation";
import { reserveDemoAiCall } from "../src/lib/server/demo-budget";
import { db } from "../src/lib/server/store";

const keys = ["WENSHAN_PUBLIC_DEMO", "WENSHAN_DEMO_DAILY_AI_LIMIT", "WENSHAN_DB_PATH"] as const;
const originalEnv = Object.fromEntries(keys.map(key => [key, process.env[key]]));
const state = globalThis as unknown as { tanshanDb?: DatabaseSync; tanshanCleanup?: NodeJS.Timeout };
const originalDb = state.tanshanDb;
const originalCleanup = state.tanshanCleanup;

function closeTestDatabase() {
  if (state.tanshanCleanup) clearInterval(state.tanshanCleanup);
  state.tanshanDb?.close();
  delete state.tanshanDb;
  delete state.tanshanCleanup;
}

beforeEach(() => {
  delete state.tanshanDb;
  delete state.tanshanCleanup;
  process.env.WENSHAN_PUBLIC_DEMO = "1";
  delete process.env.WENSHAN_DEMO_DAILY_AI_LIMIT;
  process.env.WENSHAN_DB_PATH = join(mkdtempSync(join(tmpdir(), "tanshan-demo-budget-")), "usage.sqlite");
});

afterEach(() => {
  closeTestDatabase();
  state.tanshanDb = originalDb;
  state.tanshanCleanup = originalCleanup;
  for (const key of keys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

const limitError = (error: unknown) => error instanceof AppError &&
  error.code === "DEMO_AI_LIMIT" && error.status === 429 &&
  error.message === "今天的 AI 体验次数已用完，请明天再试。";

test("default budget allows 200 upstream attempts and rejects further reservations", () => {
  for (let call = 0; call < 200; call++) reserveDemoAiCall();
  assert.throws(reserveDemoAiCall, limitError);
  assert.equal((db().prepare("SELECT used FROM demo_ai_usage").get() as { used: number }).used, 200);
});

test("custom budget is global and exhausted reservations do not increment usage", () => {
  process.env.WENSHAN_DEMO_DAILY_AI_LIMIT = "2";
  reserveDemoAiCall();
  reserveDemoAiCall();
  assert.throws(reserveDemoAiCall, limitError);
  assert.throws(reserveDemoAiCall, limitError);
  assert.equal((db().prepare("SELECT used FROM demo_ai_usage").get() as { used: number }).used, 2);
});

test("usage survives closing and reopening the database", () => {
  process.env.WENSHAN_DEMO_DAILY_AI_LIMIT = "1";
  reserveDemoAiCall();
  closeTestDatabase();
  assert.throws(reserveDemoAiCall, limitError);
});

test("a new UTC day starts a separate budget", t => {
  process.env.WENSHAN_DEMO_DAILY_AI_LIMIT = "1";
  let now = Date.parse("2026-10-19T23:59:59Z");
  t.mock.method(Date, "now", () => now);
  reserveDemoAiCall();
  assert.throws(reserveDemoAiCall, limitError);
  now = Date.parse("2026-10-20T00:00:00Z");
  reserveDemoAiCall();
  assert.throws(reserveDemoAiCall, limitError);
  const rows = db().prepare("SELECT day, used FROM demo_ai_usage ORDER BY day").all();
  assert.deepEqual(rows.map(row => ({ ...row })), [
    { day: "2026-10-19", used: 1 },
    { day: "2026-10-20", used: 1 },
  ]);
});

test("only the current UTC day and previous six days are retained", t => {
  t.mock.method(Date, "now", () => Date.parse("2026-10-19T12:00:00Z"));
  reserveDemoAiCall();
  const insert = db().prepare("INSERT INTO demo_ai_usage VALUES (?, ?)");
  for (let day = 10; day <= 18; day++) insert.run(`2026-10-${day}`, 1);
  reserveDemoAiCall();
  const rows = db().prepare("SELECT day FROM demo_ai_usage ORDER BY day").all();
  assert.equal(rows.length, 7);
  assert.equal(rows[0].day, "2026-10-13");
  assert.equal(rows.at(-1)?.day, "2026-10-19");
});

test("invalid limits reject configuration before opening a database", () => {
  for (const value of ["", " ", "0", "-1", "1.5", "Infinity", "unlimited", "9007199254740992"]) {
    process.env.WENSHAN_DEMO_DAILY_AI_LIMIT = value;
    assert.throws(reserveDemoAiCall, (error: unknown) =>
      error instanceof AppError && error.code === "CONFIGURATION" && error.status === 503);
    assert.equal(state.tanshanDb, undefined);
  }
});

test("standard mode bypasses invalid configuration and never initializes budget storage", () => {
  process.env.WENSHAN_PUBLIC_DEMO = "0";
  process.env.WENSHAN_DEMO_DAILY_AI_LIMIT = "invalid";
  reserveDemoAiCall();
  assert.equal(state.tanshanDb, undefined);
  db();
  reserveDemoAiCall();
  assert.equal(db().prepare("SELECT name FROM sqlite_master WHERE name = 'demo_ai_usage'").get(), undefined);
});
