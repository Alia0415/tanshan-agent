import type { Roundtable, RoundtableSummary } from "./engine";

export const ROUNDTABLE_STORAGE_KEY = "tanshan.roundtable-checkpoint.v1";
export type SavedRoundtable = RoundtableSummary & { checkpoint: string };

export function parseSavedRoundtable(raw: string | null, now = Date.now()): SavedRoundtable | undefined {
  if (!raw || raw.length > 262144) return;
  try {
    const value = JSON.parse(raw) as Partial<SavedRoundtable>;
    if (typeof value.id !== "string" || !/^round-[a-f0-9-]{36}$/.test(value.id) ||
      typeof value.question !== "string" || value.question.length > 200 ||
      typeof value.checkpoint !== "string" || !value.checkpoint || value.checkpoint.length > 196608 ||
      typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) ||
      typeof value.expiresAt !== "string" || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= now ||
      !["running", "complete"].includes(value.state || "") || !Number.isSafeInteger(value.messages) || (value.messages ?? -1) < 0) return;
    return value as SavedRoundtable;
  } catch { return; }
}

export function savedRoundtable(round: Roundtable): SavedRoundtable | undefined {
  if (round.provider !== "demo" || !round.checkpoint) return;
  return { id: round.id, question: round.question, checkpoint: round.checkpoint,
    createdAt: round.createdAt, expiresAt: round.expiresAt,
    state: round.scheduler.state, messages: round.messages.length };
}

/** Ignore late results from another room or an older generation in this room. */
export function acceptsRoundtableUpdate(current: Roundtable, incoming: Roundtable): boolean {
  if (incoming.id !== current.id) return false;
  if (current.checkpointRevision !== undefined || incoming.checkpointRevision !== undefined)
    return (incoming.checkpointRevision ?? -1) >= (current.checkpointRevision ?? -1);
  return incoming.scheduler.turn >= current.scheduler.turn && incoming.messages.length >= current.messages.length;
}

export function roundtableUnavailable(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return !!code && (["ROUNDTABLE_NOT_FOUND", "SESSION_NOT_FOUND", "ROUNDTABLE_MODE_CHANGED"].includes(code) || /CHECKPOINT_(?:INVALID|EXPIRED|OWNER|AUTH)/.test(code));
}
