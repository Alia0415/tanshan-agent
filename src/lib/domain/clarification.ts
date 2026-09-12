import {
  PURPOSES,
  MAX_CLARIFICATION_ROUNDS,
  type Context,
  type ContextPatch,
  type Session,
  type ClarificationCard,
} from "./types";

// Conservative local planner. Unrecognized context stays verbatim in the conversation.
// These patterns never infer a user's age, identity, budget, or personal history.
export function extractContext(text: string): ContextPatch {
  const context: ContextPatch = {};
  if (/整体了解|整体介绍|先整体|先概览/.test(text))
    context.purpose = "overview";
  else if (/怎么选|如何选|哪个好|比较|对比|值得买吗|要不要/.test(text))
    context.purpose = "decide";
  else if (/怎么解决|如何解决|怎么办|如何改善|怎么改善/.test(text))
    context.purpose = "solve";
  const priorities = [
    [/预算|价格|费用|成本|性价比/, "成本与投入"],
    [/耗时|效率|时间安排/, "时间与效率"],
    [/风险|安全|可靠/, "风险与可靠性"],
    [/上手|难度|门槛/, "难度与门槛"],
    [/体验|感受|经历/, "实际体验"],
    [/长期|前景|发展|就业/, "长期影响"],
  ] as const;
  const selected = priorities
    .filter(([pattern]) => pattern.test(text))
    .map(([, label]) => label);
  if (selected.length) context.priorities = selected.slice(0, 2);
  return context;
}

export function mergeContext(current: Context, patch: ContextPatch): Context {
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === "")
      delete (next as unknown as Record<string, unknown>)[key];
    else if (value !== undefined) Object.assign(next, { [key]: value });
  }
  return next;
}

export function focusQuestion(
  session: Pick<
    Session,
    "confirmed_context" | "original_question" | "free_text_context"
  >,
): string {
  const c = session.confirmed_context;
  const parts = [
    c.topic && `讨论对象：${c.topic}`,
    c.purpose && `目的：${PURPOSES[c.purpose]}`,
    c.scenario && `使用场景或背景：${c.scenario}`,
    c.constraints && `限制条件：${c.constraints}`,
    c.priorities.length && `关注重点：${c.priorities.join("、")}`,
  ].filter(Boolean);
  const focus = parts.length
    ? `${session.original_question}\n本次以这些条件为准：${parts.join("；")}。`
    : session.original_question;
  return session.free_text_context.length
    ? `${focus}\n补充（按先后顺序，最新表述优先）：${session.free_text_context.join("；")}`
    : focus;
}

export function nextCard(session: Session): ClarificationCard | undefined {
  const c = session.confirmed_context;
  if (session.clarification_count >= MAX_CLARIFICATION_ROUNDS || c.purpose === "overview") return;
  if (
    /直接回答|不要追问|不用追问|先整体|是什么|在哪里|在哪个城市|多少|哪年|今天.*天气/.test(
      session.original_question,
    )
  )
    return;
  if (c.priorities.length || c.scenario || c.constraints) return;
  const broad =
    /怎么样|怎么看|如何评价|值得|怎么选|如何选|哪个好|比较|对比|要不要|怎么办|怎么解决|如何解决|想了解|推荐|建议/.test(
      session.original_question,
    );
  if (!broad) return;
  if (!c.purpose)
    return {
      kind: "purpose",
      title: "你希望这个回答帮你做什么？",
      description: "可以了解观点、做选择，或解决眼前的问题。",
      fields: ["purpose"],
    };
  return {
    kind: "details",
    title: "什么背景会影响你的判断？",
    description: "补充一个场景或最多两个关注点即可；也可以直接回答。",
    fields: ["scenario", "priorities"],
  };
}

export function buildQueries(session: Session): string[] {
  const c = session.confirmed_context;
  // Reserve space for the subject and latest supplement instead of truncating new context away.
  const base = [
    (c.topic || session.original_question).slice(0, 600),
    c.scenario?.slice(0, 300),
    c.constraints?.slice(0, 300),
    [...session.free_text_context].reverse().join(" ").slice(0, 650),
  ]
    .filter(Boolean)
    .join(" ");
  return c.priorities.length
    ? c.priorities
        .slice(0, 2)
        .map((priority) => `${base} ${priority}`.slice(0, 2000))
    : [base.slice(0, 2000)];
}
