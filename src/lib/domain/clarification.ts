import {
  PURPOSES,
  type Context,
  type ContextPatch,
  type Session,
  type ClarificationCard,
} from "./types";

// Deliberately deterministic MVP fallback. Only explicit words become confirmed facts.
export function extractContext(text: string): ContextPatch {
  const context: ContextPatch = {};
  const school =
    text.match(
      /(?:中山大学|清华大学|北京大学|复旦大学|浙江大学|南京大学|武汉大学|上海交通大学|华南理工大学)/,
    )?.[0] ??
    text
      .match(/[\u4e00-\u9fa5]{2,12}(?:大学|学院)/)?.[0]
      ?.replace(
        /^(?:(?:如何评价|我想了解|想了解|了解|评价|请问|请介绍|介绍|报考|关于|想去|我想去|去|在))+/,
        "",
      );
  if (school && !["一所大学", "这所大学", "这个大学"].includes(school))
    context.school = school;
  if (!context.school && /中大/.test(text)) context.school = "中山大学";
  const purposes = [
    ...text.matchAll(
      /考研|读研|研究生|本科|高三|高考|校园生活|整体了解|整体介绍/g,
    ),
  ];
  const purpose = purposes.at(-1)?.[0];
  if (purpose)
    context.purpose = /考研|读研|研究生/.test(purpose)
      ? "postgraduate"
      : /本科|高三|高考/.test(purpose)
        ? "undergraduate"
        : /校园/.test(purpose)
          ? "campus"
          : "overview";
  const majors = [
    ...text.matchAll(
      /计算机|软件工程|人工智能|临床医学|医学|经济学|经管|法学|金融|土木工程|尚未确定/g,
    ),
  ];
  if (majors.length) context.major = majors.at(-1)![0];
  const priorities = [
    [/就业|工作前景|找工作/, "就业发展"],
    [/课程|学习体验|教学|培养/, "学习体验"],
    [/科研|导师|实验室/, "科研环境"],
    [/录取|分数|招生|报考难度/, "报考难度"],
    [/宿舍|住宿/, "住宿条件"],
    [/校园生活|生活体验|校园氛围/, "校园生活"],
    [/交通|通勤/, "交通出行"],
  ] as const;
  const selected = priorities
    .filter(([pattern]) => pattern.test(text))
    .map(([, label]) => label);
  if (selected.length) context.priorities = selected.slice(0, 2);
  if (context.purpose === "undergraduate") {
    const province = text.match(
      /广东|广西|北京|上海|江苏|浙江|山东|河南|河北|四川|湖北|湖南|福建|安徽|江西|陕西|山西|辽宁|吉林|黑龙江|云南|贵州|甘肃|海南|天津|重庆|内蒙古|宁夏|青海|西藏|新疆/,
    )?.[0];
    if (province) context.province = province;
    const year = text.match(/20\d{2}/)?.[0];
    if (year) context.year = year;
  }
  return context;
}

export function mergeContext(current: Context, patch: ContextPatch): Context {
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === "")
      delete (next as unknown as Record<string, unknown>)[key];
    else if (value !== undefined) Object.assign(next, { [key]: value });
  }
  if (next.purpose !== "undergraduate") {
    delete next.province;
    delete next.year;
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
    c.purpose && `从${PURPOSES[c.purpose]}角度`,
    c.school && `了解${c.school}`,
    c.major && `${c.major}相关情况`,
    c.priorities.length && `重点关注${c.priorities.join("和")}`,
    c.campus && `校区：${c.campus}`,
    c.province && `高考省份：${c.province}`,
    c.year && `年份：${c.year}`,
  ].filter(Boolean);
  // Keep the original question as the semantic anchor, especially for direct factual questions.
  const focus = parts.length
    ? `${session.original_question}\n本次以这些条件为准：${parts.join("，")}。`
    : session.original_question;
  return session.free_text_context.length
    ? `${focus}\n补充（按先后顺序，最新表述优先）：${session.free_text_context.join("；")}`
    : focus;
}

export function nextCard(session: Session): ClarificationCard | undefined {
  const c = session.confirmed_context;
  if (session.clarification_count >= 2 || c.purpose === "overview") return;
  if (
    /直接回答|不要追问|不用追问|先整体|在哪里|在哪个城市/.test(
      session.original_question,
    )
  )
    return;
  if (c.priorities.length) return;
  if (!c.school && !/大学|高校|专业|考研/.test(session.original_question))
    return;
  if (!c.purpose)
    return {
      kind: "purpose",
      title: "你想从哪个角度了解？",
      description: "同一所大学，对不同的人，意味着不同的选择。",
      fields: ["purpose"],
    };
  const fields: ClarificationCard["fields"] = [];
  if (["undergraduate", "postgraduate"].includes(c.purpose) && !c.major)
    fields.push("major");
  if (!c.priorities.length) fields.push("priorities");
  if (fields.length)
    return {
      kind: "details",
      title: "再聚焦一点，你最关心什么？",
      description: "只补充与你有关的信息，也可以随时直接回答。",
      fields: fields.slice(0, 2),
    };
}

export function buildQueries(session: Session): string[] {
  const c = session.confirmed_context;
  const base = [
    c.school,
    c.major === "尚未确定" ? undefined : c.major,
    c.purpose && c.purpose !== "overview" && PURPOSES[c.purpose],
    c.campus,
  ]
    .filter(Boolean)
    .join(" ");
  if (!base) return [session.original_question];
  if (c.priorities.length)
    return c.priorities
      .map((priority) => `${base} ${priority}`.trim())
      .slice(0, 2);
  return [`${base} ${session.original_question}`.trim()];
}
