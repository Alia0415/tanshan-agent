import { PURPOSES, type Session } from "./types";

/** Without a semantic plan, preserve supplied wording, including negations. */
export function fallbackConditionTags(session: Pick<Session, "confirmed_context" | "free_text_context">): string[] {
  const context = session.confirmed_context;
  const supplied = session.free_text_context.map((text) =>
    text.replace(/^关于「[\s\S]*?」：/u, "").trim(),
  ).filter((text) => text && !/^(直接回答|跳过|不用追问|不要追问|不知道|不清楚|不想说)[。！!]?$/u.test(text));
  const labels = [...new Set([
    context.topic, context.scenario, ...context.priorities, context.constraints,
    ...supplied,
  ].filter((text): text is string => Boolean(text?.trim())).map((text) => text.trim()))];
  return labels.length ? labels : context.purpose ? [PURPOSES[context.purpose]] : [];
}
