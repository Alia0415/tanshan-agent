import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";
import { z } from "zod";
import type { Roundtable } from "../roundtable/engine";
import { isPublicDemo } from "./public-demo";
import { ownerHash } from "./store";

// Browser-carried state makes demo discussions portable across disposable cloud
// instances. This is authenticated data, not encrypted storage: no credentials
// or raw visitor cookie are ever included in it.
export const MAX_ROUNDTABLE_CHECKPOINT_LENGTH = 196_608;
const MAX_CHECKPOINT_BYTES = 512 * 1024;
const PURPOSE = "wenshan:demo-roundtable-checkpoint:v1";
const processState = globalThis as unknown as { tanshanCheckpointSecret?: Buffer };

function signingKey(): Buffer {
  const seed = process.env.WENSHAN_DEMO_SESSION_SECRET?.trim() || process.env.DEEPSEEK_API_KEY?.trim();
  if (seed) return createHmac("sha256", seed).update(PURPOSE).digest();
  // A no-key local script still works within one process. Configure a stable
  // secret for cross-instance recovery when the DeepSeek key is absent.
  return processState.tanshanCheckpointSecret ??= randomBytes(32);
}

const boundedText = z.string().max(20_000);
const shortText = z.string().max(1000);
const identifiers = z.array(z.number().int().nonnegative()).max(12);
const roundSchema = z.object({
  id: z.string().min(1).max(100),
  question: z.string().min(5).max(200),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  provider: z.literal("demo"),
  model: z.string().max(200).nullable(),
  checkpointRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  sources: z.array(z.object({
    id: z.number().int().positive(), content_id: shortText, title: shortText,
    author: shortText, type: shortText, excerpt: boundedText, url: shortText,
    updated_at: shortText.optional(), comment_count: z.number().optional(),
    vote_up_count: z.number().optional(), channel: z.enum(["zhihu", "global"]).optional(),
    relevance: z.object({ reason: shortText, evidence: boundedText, caveat: shortText.optional(),
      match_level: z.enum(["direct", "background"]).optional() }).optional(),
  })).max(12),
  joinedGuestIds: z.array(shortText).max(3).optional(),
  issues: z.array(z.object({ id: shortText, question: shortText,
    state: z.enum(["open", "resolved", "needs_evidence", "stalled"]),
    attempts: z.number().int().nonnegative(), reason: shortText.optional() })).max(12).optional(),
  roles: z.array(z.object({ id: shortText, name: shortText, description: shortText,
    kind: z.enum(["host", "viewpoint", "guest"]), sourceIds: identifiers })).max(7),
  messages: z.array(z.object({
    id: shortText, speaker: shortText,
    phase: z.enum(["opening", "statement", "exchange", "summary", "followup", "user"]),
    content: boundedText, summary: shortText.optional(),
    evidencePoints: z.array(shortText).max(20).optional(),
    brief: z.object({ topic: shortText.optional(), claim: shortText, evidence: shortText,
      evidencePoints: z.array(shortText).max(20).optional() }).optional(),
    replyTo: shortText.optional(), citations: identifiers, order: z.number().int().nonnegative(),
  })).max(512),
  commonGround: z.array(shortText).max(100),
  disagreements: z.array(shortText).max(100),
  scheduler: z.object({ state: z.enum(["running", "complete"]), turn: z.number().int().nonnegative() }),
});
const payloadSchema = z.object({ version: z.literal(1), owner: z.string().regex(/^[a-f0-9]{64}$/), round: roundSchema });

export function issueRoundtableCheckpoint(round: Roundtable, token: string): string | undefined {
  if (!isPublicDemo() || round.provider !== "demo") return;
  // Strip previous checkpoints before signing; persisting one must never cause
  // recursive growth. Very long optional visitor conversations can exceed the
  // transport cap; preserve the successfully generated result without a token.
  const portable = { ...round };
  delete portable.checkpoint;
  const parsed = payloadSchema.safeParse({ version: 1, owner: ownerHash(token),
    round: { ...portable, checkpointRevision: round.checkpointRevision ?? 0 } });
  if (!parsed.success) return;
  const payload = Buffer.from(JSON.stringify(parsed.data));
  if (payload.length > MAX_CHECKPOINT_BYTES) return;
  const body = deflateSync(payload).toString("base64url");
  const signature = createHmac("sha256", signingKey()).update(`v1.${body}`).digest("base64url");
  const checkpoint = `v1.${body}.${signature}`;
  return checkpoint.length <= MAX_ROUNDTABLE_CHECKPOINT_LENGTH ? checkpoint : undefined;
}

export function restoreRoundtableCheckpoint(
  checkpoint: string | undefined, id: string, token: string,
): Roundtable | undefined {
  if (!isPublicDemo() || typeof checkpoint !== "string" || checkpoint.length > MAX_ROUNDTABLE_CHECKPOINT_LENGTH) return;
  const parts = checkpoint.split(".");
  if (parts.length !== 3 || parts[0] !== "v1" || !/^[A-Za-z0-9_-]+$/.test(parts[1]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[2])) return;
  const expected = createHmac("sha256", signingKey()).update(`v1.${parts[1]}`).digest();
  const supplied = Buffer.from(parts[2], "base64url");
  if (supplied.length !== expected.length || supplied.toString("base64url") !== parts[2] || !timingSafeEqual(supplied, expected)) return;
  try {
    // Authenticate before inflating, and bound decompression even for correctly
    // signed payloads left over from another version of the application.
    const decoded = inflateSync(Buffer.from(parts[1], "base64url"), { maxOutputLength: MAX_CHECKPOINT_BYTES });
    const parsed = payloadSchema.safeParse(JSON.parse(decoded.toString("utf8")));
    if (!parsed.success) return;
    const { owner, round } = parsed.data;
    const now = Date.now();
    const created = Date.parse(round.createdAt);
    const expires = Date.parse(round.expiresAt);
    if (round.id !== id || owner !== ownerHash(token) || expires <= now || created > now + 60_000 ||
      expires <= created || expires - created > 86_400_000) return;
    return round;
  } catch {
    return;
  }
}
