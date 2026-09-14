import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { AppError } from "../domain/validation";

// SQLite coordinates workers too; never hold a database transaction across a model call.
export async function mutateRoundtable<T>(
  connection: DatabaseSync, id: string, work: (assertOwner: () => void) => Promise<T>,
): Promise<T> {
  connection.exec(`CREATE TABLE IF NOT EXISTS roundtable_locks (
    id TEXT PRIMARY KEY, token TEXT NOT NULL, expires INTEGER NOT NULL
  )`);
  const token = randomUUID();
  const acquired = connection.prepare(`INSERT INTO roundtable_locks VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET token = excluded.token, expires = excluded.expires
    WHERE roundtable_locks.expires <= ?`).run(id, token, Date.now() + 600_000, Date.now());
  if (!acquired.changes) throw new AppError("ROUNDTABLE_BUSY", "本场讨论正在生成，请完成后再试。", 409);
  try {
    return await work(() => {
      const lock = connection.prepare("SELECT token, expires FROM roundtable_locks WHERE id = ?").get(id) as { token: string; expires: number } | undefined;
      if (lock?.token !== token || lock.expires <= Date.now())
        throw new AppError("ROUNDTABLE_CONFLICT", "生成等待过久，请刷新讨论后重试。", 409);
    });
  } finally {
    connection.prepare("DELETE FROM roundtable_locks WHERE id = ? AND token = ?").run(id, token);
  }
}
