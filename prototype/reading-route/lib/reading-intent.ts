export type ReadingTurn = { prompt: string; answer: string };
export type ReadingQuestion = { prompt: string; hint: string; options: Array<{ id: string; label: string; detail: string }> };
export const MAX_TURNS = 3;
export function readHistory(value: unknown): ReadingTurn[] {
  if (!Array.isArray(value) || value.length > MAX_TURNS) throw new Error("INVALID_HISTORY");
  return value.map(turn => {
    if (!turn || typeof turn.prompt !== "string" || typeof turn.answer !== "string" || !turn.prompt.trim() || !turn.answer.trim() || turn.prompt.length > 300 || turn.answer.length > 600) throw new Error("INVALID_HISTORY");
    return { prompt: turn.prompt.trim(), answer: turn.answer.trim() };
  });
}
export function describeIntent(history: ReadingTurn[]) {
  return history.length ? history.map((turn, index) => `${index + 1}. 问：${turn.prompt}\n答：${turn.answer}`).join("\n") : "用户跳过追问：不推测身份，以当前问题的观点全貌为目标。";
}
