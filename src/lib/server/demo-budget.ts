import { AppError } from "../domain/validation";
import { isPublicDemo } from "./public-demo";
import { db } from "./store";

/** Reserve one paid upstream attempt; failed requests deliberately keep the reservation. */
export function reserveDemoAiCall(): void {
  if (!isPublicDemo()) return;

  const value = process.env.WENSHAN_DEMO_DAILY_AI_LIMIT ?? "200";
  const limit = Number(value);
  if (!/^\d+$/.test(value.trim()) || !Number.isSafeInteger(limit) || limit <= 0) {
    throw new AppError("CONFIGURATION", "在线 AI 体验次数配置必须是有效正整数。", 503);
  }

  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const oldestDay = new Date(now - 6 * 86_400_000).toISOString().slice(0, 10);
  const connection = db();
  connection.exec(`CREATE TABLE IF NOT EXISTS demo_ai_usage (
    day TEXT PRIMARY KEY,
    used INTEGER NOT NULL CHECK (used >= 0)
  )`);
  connection.prepare("DELETE FROM demo_ai_usage WHERE day < ?").run(oldestDay);
  const result = connection.prepare(`
    INSERT INTO demo_ai_usage (day, used) VALUES (?, 1)
    ON CONFLICT(day) DO UPDATE SET used = used + 1 WHERE used < ?
  `).run(day, limit);
  if (!result.changes) {
    throw new AppError("DEMO_AI_LIMIT", "今天的 AI 体验次数已用完，请明天再试。", 429);
  }
}
