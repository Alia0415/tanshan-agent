import { z } from "zod";
import { isZhihuPostUrl } from "../domain/sources";
import { db, ownerHash, transaction } from "./store";

export const RESONANCE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const resonanceInputSchema = z
  .object({
    question: z.string().trim().min(1, "问题不能为空").max(2000, "问题最多 2,000 字符"),
    source_id: z.string().trim().min(1, "帖子标识不能为空").max(200),
    source_title: z.string().trim().min(1, "帖子标题不能为空").max(500),
    source_author: z.string().trim().min(1, "作者不能为空").max(200),
    source_url: z
      .string()
      .trim()
      .min(1, "帖子链接不能为空")
      .max(2048, "帖子链接过长")
      .refine(isZhihuPostUrl, "只能连接知乎帖子"),
  })
  .strict();

export type ResonanceInput = z.infer<typeof resonanceInputSchema>;
export type ResonanceResult = {
  connected: true;
  count: number;
  created: boolean;
};

const state = globalThis as unknown as { tanshanResonance?: boolean };

function ensureTable() {
  if (state.tanshanResonance) return;
  db().exec(`
    CREATE TABLE IF NOT EXISTS resonance_signals (
      topic_key TEXT NOT NULL,
      owner TEXT NOT NULL,
      expires INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      question TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_title TEXT NOT NULL,
      source_author TEXT NOT NULL,
      source_url TEXT NOT NULL,
      PRIMARY KEY (topic_key, owner)
    );
    CREATE INDEX IF NOT EXISTS resonance_expiry ON resonance_signals(expires);
    CREATE INDEX IF NOT EXISTS resonance_topic_expiry
      ON resonance_signals(topic_key, expires);
  `);
  state.tanshanResonance = true;
}

/**
 * Answers under one Zhihu question share a resonance topic. Legacy answer URLs
 * and articles do not expose a question ID, so their stable source ID is used.
 */
export function resonanceTopicKey(input: Pick<ResonanceInput, "source_id" | "source_url">) {
  const match = new URL(input.source_url).pathname.match(/^\/question\/(\d+)(?:\/|$)/);
  return match ? `question:${match[1]}` : `source:${input.source_id}`;
}

export function connectResonance(
  input: ResonanceInput,
  token: string,
  now = Date.now(),
): ResonanceResult {
  ensureTable();
  const connection = db();
  const topicKey = resonanceTopicKey(input);
  const expires = now + RESONANCE_TTL_MS;
  const owner = ownerHash(token);

  return transaction(() => {
    connection
      .prepare("DELETE FROM resonance_signals WHERE expires <= ?")
      .run(now);
    const inserted = connection
      .prepare(`
        INSERT INTO resonance_signals (
          topic_key, owner, expires, created_at, question,
          source_id, source_title, source_author, source_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(topic_key, owner) DO NOTHING
      `)
      .run(
        topicKey,
        owner,
        expires,
        now,
        input.question,
        input.source_id,
        input.source_title,
        input.source_author,
        input.source_url,
      );
    const count = connection
      .prepare(
        "SELECT COUNT(*) AS count FROM resonance_signals WHERE topic_key = ? AND expires > ?",
      )
      .get(topicKey, now) as { count: number };

    return {
      connected: true,
      count: count.count,
      created: inserted.changes === 1,
    };
  });
}
