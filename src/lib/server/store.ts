import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import type { Session } from "../domain/types";
import { AppError } from "../domain/validation";

type Row = { data: string; owner: string; expires: number };
const state = globalThis as unknown as {
  wenshanDb?: DatabaseSync;
  wenshanCleanup?: NodeJS.Timeout;
};
export const ownerHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export function db() {
  if (state.wenshanDb) return state.wenshanDb;
  // The database is created at runtime; never trace local data or environment files into the build.
  const path = resolve(
    /* turbopackIgnore: true */ process.env.WENSHAN_DB_PATH ||
      ".data/wenshan.sqlite",
  );
  mkdirSync(dirname(path), { recursive: true });
  const connection = new DatabaseSync(path);
  connection.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA secure_delete = ON;
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, owner TEXT NOT NULL, expires INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);
    CREATE TABLE IF NOT EXISTS requests (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      request_id TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL,
      PRIMARY KEY(session_id, request_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_running_answer ON requests(session_id) WHERE status = 'running';
    CREATE TABLE IF NOT EXISTS feedback (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      answer_id TEXT NOT NULL, type TEXT NOT NULL, reason TEXT,
      PRIMARY KEY(session_id, answer_id)
    );
  `);
  state.wenshanDb = connection;
  // Recovery is explicit: a new process never replays a paid POST from an old process.
  const interrupted = connection
    .prepare(
      "SELECT id, data FROM sessions WHERE id IN (SELECT session_id FROM requests WHERE status = 'running')",
    )
    .all() as { id: string; data: string }[];
  for (const row of interrupted) {
    const session = JSON.parse(row.data) as Session;
    if (["searching", "generating"].includes(session.stage)) {
      session.stage = "error";
      session.error = {
        code: "INTERRUPTED",
        message: "上次连接已中断，生成未完成。你可以手动重试。",
      };
      connection
        .prepare("UPDATE sessions SET data = ? WHERE id = ?")
        .run(JSON.stringify(session), row.id);
    }
  }
  connection
    .prepare(
      "UPDATE requests SET status = 'interrupted' WHERE status = 'running'",
    )
    .run();
  cleanup();
  state.wenshanCleanup = setInterval(cleanup, 60_000);
  state.wenshanCleanup.unref();
  return connection;
}

export function cleanup() {
  state.wenshanDb
    ?.prepare("DELETE FROM sessions WHERE expires <= ?")
    .run(Date.now());
}

export function insertSession(session: Session, token: string) {
  const connection = db();
  cleanup();
  const count = connection
    .prepare("SELECT COUNT(*) AS n FROM sessions WHERE owner = ?")
    .get(ownerHash(token)) as { n: number };
  if (count.n >= 50)
    throw new AppError(
      "SESSION_LIMIT",
      "今天创建的会话较多，请稍后再试。",
      429,
    );
  connection
    .prepare("INSERT INTO sessions VALUES (?, ?, ?, ?)")
    .run(
      session.session_id,
      ownerHash(token),
      Date.parse(session.expires_at),
      JSON.stringify(session),
    );
}

export function getSession(id: string, token?: string): Session {
  const row = db()
    .prepare("SELECT data, owner, expires FROM sessions WHERE id = ?")
    .get(id) as Row | undefined;
  if (
    !row ||
    row.expires <= Date.now() ||
    (token !== undefined && row.owner !== ownerHash(token))
  ) {
    cleanup();
    throw new AppError(
      "SESSION_NOT_FOUND",
      "会话已过期或无法访问，请开始新的提问。",
      404,
    );
  }
  return JSON.parse(row.data) as Session;
}

export function saveSession(session: Session) {
  db()
    .prepare("UPDATE sessions SET data = ? WHERE id = ?")
    .run(JSON.stringify(session), session.session_id);
}

export function checkVersion(session: Session, version: number) {
  if (session.context_version !== version)
    throw new AppError(
      "CONTEXT_CHANGED",
      "条件已更新，请使用最新条件再试。",
      409,
    );
}

export function transaction<T>(operation: () => T): T {
  const connection = db();
  connection.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    connection.exec("COMMIT");
    return result;
  } catch (error) {
    connection.exec("ROLLBACK");
    throw error;
  }
}
