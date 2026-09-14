import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { MAX_CLARIFICATION_ROUNDS, type Session } from "../domain/types";
import {
  AppError,
  type clarifySchema,
  type patchSchema,
  type feedbackSchema,
} from "../domain/validation";
import {
  buildQueries,
  extractContext,
  focusQuestion,
  mergeContext,
} from "../domain/clarification";
import { planClarification, type ClarificationPlanner } from "./clarification-planner";
import { retrieve } from "./retrieval";
import { fallbackConditionTags } from "../domain/condition-tags";
import {
  checkVersion,
  db,
  getSession,
  insertSession,
  saveSession,
  transaction,
} from "./store";
import {
  guidance,
  sourceDraft,
  ZhihuProvider,
  type KnowledgeProvider,
} from "./providers";

export async function createSession(question: string, token: string, planner: ClarificationPlanner = planClarification) {
  const provider = process.env.WENSHAN_PROVIDER || "demo";
  if (!["demo", "live"].includes(provider))
    throw new AppError("CONFIGURATION", "服务配置暂不可用。", 503);
  const session: Session = {
    schema_version: 2,
    session_id: randomUUID(),
    original_question: question,
    stage: "understanding",
    context_version: 1,
    clarification_count: 0,
    confirmed_context: mergeContext(
      { priorities: [] },
      extractContext(question),
    ),
    free_text_context: [],
    clarification_history: [],
    focused_question: "",
    answers: [],
    provider: provider as "demo" | "live",
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400000).toISOString(),
  };
  session.clarification = await planner(session);
  session.stage = session.clarification ? "clarifying" : "ready";
  session.focused_question = focusQuestion(session);
  insertSession(session, token);
  return { session, auto_answer: !session.clarification };
}

function supplement(session: Session, text?: string, contextText = text) {
  if (!text) return;
  if (session.free_text_context.join("").length + text.length > 16000)
    throw new AppError(
      "CONTEXT_LIMIT",
      "当前会话补充较多，请精简条件或开始新的提问。",
    );
  session.free_text_context.push(text);
  session.confirmed_context = mergeContext(
    session.confirmed_context,
    extractContext(contextText || ""),
  );
}

export async function clarify(
  id: string,
  token: string,
  input: z.infer<typeof clarifySchema>,
  planner: ClarificationPlanner = planClarification,
) {
  const session = getSession(id, token);
  checkVersion(session, input.context_version);
  if (session.stage !== "clarifying" || !session.clarification)
    throw new AppError(
      "INVALID_STAGE",
      "当前无需补充条件，请使用最新页面。",
      409,
    );
  if (
    Object.keys(input.selections).some(
      (key) =>
        !session.clarification!.fields.includes(
          key as "purpose" | "scenario" | "constraints" | "priorities",
        ),
    )
  )
    throw new AppError("INVALID_SELECTION", "请选择当前卡片提供的条件。");
  const answers = Array.isArray(input.answer) ? input.answer : input.answer ? [input.answer] : [];
  if (answers.length > 1 && session.clarification.selection_mode !== "multiple")
    throw new AppError("INVALID_SELECTION", "当前追问只能选择一个选项。");
  if (answers.length && (session.clarification.kind !== "contextual" ||
    answers.some((answer) => !session.clarification!.options?.includes(answer))))
    throw new AppError("INVALID_SELECTION", "请选择当前追问提供的选项，或使用文字补充。");
  if (
    !input.skip &&
    !answers.length &&
    !input.free_text &&
    !Object.values(input.selections).some((value) =>
      Array.isArray(value) ? value.length > 0 : Boolean(value),
    )
  )
    throw new AppError(
      "EMPTY_SELECTION",
      "请选择至少一个选项、补充文字，或直接回答。",
    );
  const previousCard = session.clarification;
  session.confirmed_context = mergeContext(
    session.confirmed_context,
    input.selections,
  );
  if (previousCard.kind === "contextual") {
    const answer = [...answers, input.free_text].filter(Boolean).join("；");
    if (answer) {
      // Keep the question with its answer so a short choice retains its meaning downstream.
      supplement(session, `关于「${previousCard.title}」：${answer}`, answer);
      session.clarification_history = [...(session.clarification_history || []),
        { question: previousCard.title, answer, card: structuredClone(previousCard),
          selected: answers, free_text: input.free_text || "",
          supplement_index: session.free_text_context.length - 1 }];
    }
  } else {
    supplement(session, input.free_text);
    session.clarification_history = [...(session.clarification_history || []), {
      question: previousCard.title,
      answer: [JSON.stringify(input.selections), input.free_text].filter(Boolean).join("；"),
    }];
  }
  session.clarification_count += 1;
  session.context_version += 1;
  // Plan outside the SQLite transaction; a late model reply cannot overwrite a context edit.
  session.clarification =
    !input.skip &&
    session.clarification_count < MAX_CLARIFICATION_ROUNDS &&
    !/^(直接回答|跳过|不用追问|不要追问|不知道|不清楚|不想说)[。！!]?$/u.test(input.free_text || "") &&
    (previousCard.kind === "contextual" ||
      (previousCard.kind === "purpose" && session.confirmed_context.purpose))
      ? await planner(session)
      : undefined;
  session.stage = session.clarification ? "clarifying" : "ready";
  session.focused_question = focusQuestion(session);
  return transaction(() => {
    const current = getSession(id, token);
    checkVersion(current, input.context_version);
    if (current.stage !== "clarifying")
      throw new AppError("INVALID_STAGE", "当前状态已更新，请刷新后继续。", 409);
    saveSession(session);
    return {
      session,
      auto_answer:
        !session.clarification && (previousCard.kind === "contextual" ||
          input.skip || session.confirmed_context.purpose === "overview"),
    };
  });
}

export function updateContext(
  id: string,
  token: string,
  input: z.infer<typeof patchSchema>,
) {
  return transaction(() => {
    const session = getSession(id, token);
    checkVersion(session, input.context_version);
    session.confirmed_context = mergeContext(
      session.confirmed_context,
      input.changes,
    );
    if (input.clarification_revision) {
      const revision = input.clarification_revision;
      const turn = session.clarification_history?.[revision.history_index];
      if (!turn) throw new AppError("INVALID_SELECTION", "找不到对应追问，请刷新后重试。");
      if (revision.selected.length && (!turn.card?.options ||
        revision.selected.some((option) => !turn.card!.options!.includes(option)) ||
        (turn.card.selection_mode !== "multiple" && revision.selected.length > 1)))
        throw new AppError("INVALID_SELECTION", "请选择原追问提供的选项。");
      const answer = [...revision.selected, revision.free_text?.trim()].filter(Boolean).join("；");
      if (!answer) throw new AppError("EMPTY_SELECTION", "请选择至少一项或填写补充内容。");
      const oldSupplement = "关于「" + turn.question + "」：" + turn.answer;
      const index = turn.supplement_index ?? session.free_text_context.indexOf(oldSupplement);
      if (index < 0 || session.free_text_context[index] !== oldSupplement)
        throw new AppError("INVALID_SELECTION", "这条历史追问缺少可修改记录，请使用修改本次条件。");
      const replacement = "关于「" + turn.question + "」：" + answer;
      if (session.free_text_context.join("").length - oldSupplement.length + replacement.length > 16000)
        throw new AppError("CONTEXT_LIMIT", "补充内容过长，请精简后重试。");
      session.free_text_context[index] = replacement;
      const oldDerived = extractContext(turn.answer);
      const otherText = [session.original_question, ...session.free_text_context.filter((_, i) => i !== index)].join("；");
      const otherDerived = extractContext(otherText);
      if (oldDerived.priorities) session.confirmed_context.priorities = session.confirmed_context.priorities.filter(
        (priority) => !oldDerived.priorities!.includes(priority) || otherDerived.priorities?.includes(priority));
      if (oldDerived.purpose && session.confirmed_context.purpose === oldDerived.purpose)
        session.confirmed_context.purpose = otherDerived.purpose || undefined;
      session.confirmed_context = mergeContext(session.confirmed_context, extractContext(answer));
      turn.answer = answer;
      turn.selected = [...revision.selected];
      turn.free_text = revision.free_text?.trim() || "";
    }
    supplement(session, input.free_text);
    session.context_version += 1;
    session.stage = "ready";
    session.clarification = undefined;
    session.error = undefined;
    session.focused_question = focusQuestion(session);
    db()
      .prepare(
        "UPDATE requests SET status = 'superseded' WHERE session_id = ? AND status = 'running'",
      )
      .run(id);
    saveSession(session);
    return { session };
  });
}

export function claimAnswer(
  id: string,
  token: string,
  version: number,
  requestId: string,
) {
  return transaction(() => {
    const session = getSession(id, token);
    checkVersion(session, version);
    const existing = db()
      .prepare(
        "SELECT request_id, version FROM requests WHERE session_id = ? AND request_id = ?",
      )
      .get(id, requestId) as
      { request_id: string; version: number } | undefined;
    if (existing) {
      if (existing.version !== version)
        throw new AppError(
          "REQUEST_REUSED",
          "本次请求标识已用于此前条件，请重新提交。",
          409,
        );
      return { session, start: false };
    }
    const running = db()
      .prepare(
        "SELECT request_id FROM requests WHERE session_id = ? AND status = 'running'",
      )
      .get(id);
    if (
      running ||
      session.answers.some((answer) => answer.context_version === version)
    )
      return { session, start: false };
    if (!["ready", "error"].includes(session.stage))
      throw new AppError(
        "INVALID_STAGE",
        "请先确认当前问题，或使用直接回答。",
        409,
      );
    const attempts = db()
      .prepare("SELECT COUNT(*) AS n FROM requests WHERE session_id = ?")
      .get(id) as { n: number };
    if (attempts.n >= 20)
      throw new AppError(
        "ATTEMPT_LIMIT",
        "当前会话请求较多，请稍后开始新的提问。",
        429,
      );
    db()
      .prepare("INSERT INTO requests VALUES (?, ?, ?, 'running')")
      .run(id, requestId, version);
    session.stage = "searching";
    session.error = undefined;
    saveSession(session);
    return { session, start: true };
  });
}

export async function runAnswer(
  id: string,
  version: number,
  requestId: string,
  provider: KnowledgeProvider = new ZhihuProvider(),
) {
  const isCurrent = () => {
    const session = getSession(id);
    return session.context_version === version &&
      ["searching", "generating"].includes(session.stage)
      ? session
      : undefined;
  };
  try {
    let session = isCurrent();
    if (!session) return;
    let queries = buildQueries(session);
    let searchInfo;
    let conditionTags = fallbackConditionTags(session);
    let conditionSources: { label: string; history_index: number }[] = [];
    const warnings: string[] = [];
    let sources: Awaited<ReturnType<KnowledgeProvider["search"]>> = [];
    if (session.provider === "live") {
      const result = await retrieve(session, provider, () => Boolean(isCurrent()));
      sources = result.sources;
      queries = result.queries;
      warnings.push(...result.warnings);
      searchInfo = result.info;
      if (result.conditionTags.length) conditionTags = result.conditionTags;
      conditionSources = result.conditionSources;
    } else {
      await new Promise((resolve) => setTimeout(resolve, 450));
    }
    session = isCurrent();
    if (!session) return;
    session.stage = "generating";
    saveSession(session);
    let draft;
    if (session.provider === "demo" || !sources.length) {
      draft = guidance(session, session.provider === "demo");
    } else {
      try {
        draft = await provider.generate(session, sources);
      } catch (error) {
        if (!(error instanceof AppError) || error.code !== "RATE_LIMITED")
          throw error;
        draft = sourceDraft(
          sources,
          "知乎直答额度或频率受限，已停止生成并保留本次真实检索资料。",
        );
      }
    }
    if (session.provider === "demo")
      await new Promise((resolve) => setTimeout(resolve, 650));
    session = isCurrent();
    if (!session) return;
    session.answers.push({
      ...draft,
      limitations: [...new Set([...draft.limitations, ...warnings])],
      id: randomUUID(),
      context_version: version,
      context: structuredClone(session.confirmed_context),
      condition_tags: conditionTags,
      condition_sources: conditionSources,
      clarification_history: structuredClone(session.clarification_history || []),
      focused_question: session.focused_question,
      sources,
      queries,
      search_info: searchInfo,
      evidence:
        session.provider === "demo"
          ? "demo"
          : draft.format === "zhida_text"
            ? "unverified"
            : sources.length
              ? "sources"
              : "insufficient",
      created_at: new Date().toISOString(),
    });
    session.stage = "completed";
    transaction(() => {
      saveSession(session);
      db()
        .prepare(
          "UPDATE requests SET status = 'completed' WHERE session_id = ? AND request_id = ?",
        )
        .run(id, requestId);
    });
  } catch (error) {
    try {
      const session = isCurrent();
      if (!session) return;
      const appError =
        error instanceof AppError
          ? error
          : new AppError(
              "INTERNAL_ERROR",
              "本次回答未完成，你可以手动重试。",
              500,
            );
      session.stage = "error";
      session.error = { code: appError.code, message: appError.message };
      transaction(() => {
        saveSession(session);
        db()
          .prepare(
            "UPDATE requests SET status = 'failed' WHERE session_id = ? AND request_id = ?",
          )
          .run(id, requestId);
      });
    } catch {
      /* Session expiry or deletion cancels delivery; never replay the request. */
    }
  }
}

export function addFeedback(
  id: string,
  token: string,
  input: z.infer<typeof feedbackSchema>,
) {
  const session = getSession(id, token);
  if (!session.answers.some((answer) => answer.id === input.answer_id))
    throw new AppError("ANSWER_NOT_FOUND", "未找到对应回答。", 404);
  db()
    .prepare(
      "INSERT INTO feedback VALUES (?, ?, ?, ?) ON CONFLICT(session_id, answer_id) DO UPDATE SET type = excluded.type, reason = excluded.reason",
    )
    .run(id, input.answer_id, input.type, input.reason || null);
  return { received: true };
}
