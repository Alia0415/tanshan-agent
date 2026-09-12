import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { Session } from "../domain/types";
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
  nextCard,
} from "../domain/clarification";
import { filterZhihuPosts } from "../domain/sources";
import {
  checkVersion,
  db,
  getSession,
  insertSession,
  saveSession,
  transaction,
} from "./store";
import {
  deduplicate,
  guidance,
  sourceDraft,
  ZhihuProvider,
  type KnowledgeProvider,
} from "./providers";

export function createSession(question: string, token: string) {
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
    focused_question: "",
    answers: [],
    provider: provider as "demo" | "live",
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400000).toISOString(),
  };
  session.clarification = nextCard(session);
  session.stage = session.clarification ? "clarifying" : "ready";
  session.focused_question = focusQuestion(session);
  insertSession(session, token);
  return { session, auto_answer: !session.clarification };
}

function supplement(session: Session, text?: string) {
  if (!text) return;
  if (session.free_text_context.join("").length + text.length > 8000)
    throw new AppError(
      "CONTEXT_LIMIT",
      "当前会话补充较多，请精简条件或开始新的提问。",
    );
  session.free_text_context.push(text);
  session.confirmed_context = mergeContext(
    session.confirmed_context,
    extractContext(text),
  );
}

export function clarify(
  id: string,
  token: string,
  input: z.infer<typeof clarifySchema>,
) {
  return transaction(() => {
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
    if (
      !input.skip &&
      !input.free_text &&
      !Object.values(input.selections).some((value) =>
        Array.isArray(value) ? value.length > 0 : Boolean(value),
      )
    )
      throw new AppError(
        "EMPTY_SELECTION",
        "请选择一个选项、补充文字，或直接回答。",
      );
    const previousCard = session.clarification;
    session.confirmed_context = mergeContext(
      session.confirmed_context,
      input.selections,
    );
    supplement(session, input.free_text);
    session.clarification_count += 1;
    session.context_version += 1;
    // A submitted card is never re-asked if free text could not be classified.
    session.clarification =
      !input.skip &&
      previousCard.kind === "purpose" &&
      session.confirmed_context.purpose
        ? nextCard(session)
        : undefined;
    session.stage = session.clarification ? "clarifying" : "ready";
    session.focused_question = focusQuestion(session);
    saveSession(session);
    return {
      session,
      auto_answer:
        input.skip || session.confirmed_context.purpose === "overview",
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
    const queries = buildQueries(session);
    const warnings: string[] = [];
    let sources: Awaited<ReturnType<KnowledgeProvider["search"]>> = [];
    let successfulSearches = 0;
    if (session.provider === "live") {
      let lastError: unknown;
      for (const query of queries) {
        if (!isCurrent()) return;
        try {
          sources.push(...filterZhihuPosts(await provider.search(query)));
          successfulSearches += 1;
        } catch (error) {
          if (
            error instanceof AppError &&
            ["AUTH_REQUIRED", "AUTH_INVALID", "RATE_LIMITED"].includes(
              error.code,
            )
          )
            throw error;
          warnings.push("部分资料未能获取，本次回答仅覆盖已返回内容。");
          lastError = error;
        }
      }
      if (!successfulSearches)
        throw (
          lastError ||
          new AppError("SEARCH_FAILED", "本次未能完成搜索，请稍后重试。", 502)
        );
      // One simplified retry, only for genuinely empty results; total query budget <= 3.
      if (!sources.length && queries.length < 3) {
        const simplified =
          session.confirmed_context.topic ||
          session.original_question.slice(0, 80);
        if (!queries.includes(simplified)) {
          queries.push(simplified);
          if (!isCurrent()) return;
          try {
            sources.push(
              ...filterZhihuPosts(await provider.search(simplified)),
            );
          } catch (error) {
            if (
              error instanceof AppError &&
              ["AUTH_REQUIRED", "AUTH_INVALID", "RATE_LIMITED"].includes(
                error.code,
              )
            )
              throw error;
            warnings.push("简化关键词后仍未获取到更多资料。");
          }
        }
      }
      sources = deduplicate(sources);
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
      focused_question: session.focused_question,
      sources,
      queries,
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
