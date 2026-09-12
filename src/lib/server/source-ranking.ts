import type { Source } from "../domain/types";

const DAY_MS = 86400000;
function interactionBonus(count: number | undefined, scale: number): number {
  if (count === undefined || !Number.isSafeInteger(count) || count < 0) return 0;
  // Diminishing returns keep an old viral post from dominating every other signal.
  return Math.min(1, Math.log1p(count) / Math.log1p(scale));
}

/** A secondary preference only: callers must compare relevance and constraints first. */
export function sourcePreference(source: Source, nowMs = Date.now()): number {
  const edited = source.updated_at ? Date.parse(source.updated_at) : NaN;
  const recency = Number.isFinite(edited) && edited > 0 && edited <= nowMs
    ? 1 / (1 + (nowMs - edited) / (365 * DAY_MS))
    : 0;
  // Missing metadata earns no bonus; it is never displayed or persisted as a zero count.
  return 0.4 * interactionBonus(source.comment_count, 1000)
    + 0.35 * interactionBonus(source.vote_up_count, 10000)
    + 0.25 * recency;
}
