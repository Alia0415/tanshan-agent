import { z } from "zod";
import { ANSWER_INSTRUCTIONS } from "../agent/definition";
import type { Answer, AnswerSection, Session, Source } from "../domain/types";
import { AppError } from "../domain/validation";
import { isZhihuPostUrl } from "../domain/sources";

export interface Draft {
  format?: Answer["format"];
  summary: string;
  summary_citations: number[];
  sections: AnswerSection[];
  limitations: string[];
}
export interface KnowledgeProvider {
  search(query: string, count?: number): Promise<Source[]>;
  generate(session: Session, sources: Source[]): Promise<Draft>;
}

export function safeUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : undefined;
  } catch {
    return;
  }
}
export const plainText = (value: string) =>
  value.replace(/<[^>]*>/g, "").trim();
export function deduplicate(sources: Source[]): Source[] {
  const ids = new Set<string>();
  const urls = new Set<string>();
  return sources
    .filter((source) => {
      const safe = safeUrl(source.url);
      if (!safe) return false;
      const url = new URL(safe);
      const canonical = `${url.hostname}${url.pathname.replace(/\/$/, "")}`;
      if (
        (source.content_id && ids.has(source.content_id)) ||
        urls.has(canonical)
      )
        return false;
      if (source.content_id) ids.add(source.content_id);
      urls.add(canonical);
      return true;
    })
    .map((source, index) => ({ ...source, id: index + 1 }));
}

// Optional metadata must not invalidate an otherwise usable post or invent zero counts.
const interactionCount = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional().catch(undefined);
const itemSchema = z.object({
  Title: z.string(),
  ContentType: z.string(),
  ContentID: z.string(),
  ContentText: z.string(),
  Url: z.string(),
  AuthorName: z.string(),
  EditTime: z.number().int().nonnegative().optional().catch(undefined),
  CommentCount: interactionCount,
  VoteUpCount: interactionCount,
});
const responseSchema = z.object({
  Code: z.number(),
  Data: z.unknown().optional(),
});
const searchDataSchema = z.object({ Items: z.array(itemSchema) });
const citations = z.array(z.number().int().positive()).min(1).max(10);
const draftSchema = z.object({
  summary: z.string().min(1).max(2000),
  summary_citations: citations,
  sections: z
    .array(
      z.object({
        title: z.string().max(100),
        body: z.string().min(1).max(4000),
        citations,
      }),
    )
    .min(1)
    .max(8),
  limitations: z.array(z.string().max(500)).max(8),
});

export function parseDraft(
  content: string,
  sources: Source[],
): Draft | undefined {
  try {
    const parsed = draftSchema.safeParse(
      JSON.parse(
        content
          .trim()
          .replace(/^```(?:json)?\s*/, "")
          .replace(/\s*```$/, ""),
      ),
    );
    if (!parsed.success) return;
    const known = new Set(sources.map((source) => source.id));
    if (
      [
        ...parsed.data.summary_citations,
        ...parsed.data.sections.flatMap((section) => section.citations),
      ].some((id) => !known.has(id))
    )
      return;
    return parsed.data;
  } catch {
    return;
  }
}

export async function request(url: string, options: RequestInit = {}) {
  const secret = process.env.ZHIHU_ACCESS_SECRET?.trim();
  if (!secret)
    throw new AppError(
      "AUTH_REQUIRED",
      "服务暂未配置资料访问凭证，请联系维护者。",
      503,
    );
  const configuredTimeout = Number(process.env.ZHIHU_TIMEOUT_MS || 120000);
  const timeout = Number.isFinite(configuredTimeout)
    ? Math.min(120000, Math.max(1000, configuredTimeout))
    : 120000;
  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      cache: "no-store",
      signal: AbortSignal.timeout(
        options.method === "POST" ? timeout : Math.min(timeout, 20000),
      ),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
        "X-Request-Timestamp": String(Math.floor(Date.now() / 1000)),
      },
    });
  } catch (error) {
    if (
      error instanceof Error &&
      ["TimeoutError", "AbortError"].includes(error.name)
    )
      throw new AppError("TIMEOUT", "本次请求等待超时，你可以手动重试。", 504);
    throw new AppError(
      "UPSTREAM_UNAVAILABLE",
      "暂时无法连接资料服务，请稍后重试。",
      502,
    );
  }
  if ([401, 403].includes(response.status))
    throw new AppError(
      "AUTH_INVALID",
      "资料服务的访问授权暂不可用，请联系维护者。",
      503,
    );
  if (response.status === 429)
    throw new AppError(
      "RATE_LIMITED",
      "当前服务额度或频率受限，请稍后再试。",
      429,
    );
  if (!response.ok)
    throw new AppError(
      "UPSTREAM_ERROR",
      "资料服务暂时没有完成请求，请稍后重试。",
      502,
    );
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new AppError(
      "INVALID_RESPONSE",
      "资料服务返回的内容无法读取，请稍后重试。",
      502,
    );
  }
}

export function guidance(session: Session, demo: boolean): Draft {
  const topics = session.confirmed_context.priorities.length
    ? session.confirmed_context.priorities
    : ["明确适用条件", "核对证据与下一步"];
  const tips: Record<string, string> = {
    成本与投入:
      "列出预算、时间与后续维护成本，再比较不同方案。价格和费用需要核对当前资料。",
    时间与效率: "先明确可投入的时间、截止日期和最小目标，再比较可行的安排。",
    风险与可靠性: "区分可逆的尝试与影响较大的决定，核对证据来源和适用条件。",
    难度与门槛:
      "从当前基础和可用资源出发，先做一个小范围尝试，再判断是否继续。",
    实际体验:
      "对照分享者的背景、使用场景和经历时间。单一个人的体验不代表所有人。",
    长期影响: "分别考虑眼前收益、后续发展和改变选择的成本。",
  };
  return {
    summary: demo
      ? "这是问山 Agent 的流程演示，尚未查询真实知乎资料。以下展示回答的组织方式。"
      : "本次未找到足够相关的资料，暂时无法给出有来源支持的结论。",
    summary_citations: [],
    sections: topics.map((title) => ({
      title,
      body:
        tips[title] ||
        "围绕你的实际场景、限制和目标，对照可核查资料与不同背景的个人经历，再决定下一步。",
      citations: [],
    })),
    limitations: [
      demo
        ? "演示模式未调用真实搜索或直答，也未生成虚构来源。"
        : "当前资料不足，可以缩小问题范围或补充条件后再试。",
      "以上仅展示分析思路，不是针对该问题的事实结论。",
    ],
  };
}

export function sourceDraft(sources: Source[], reason: string): Draft {
  return {
    format: "source_excerpts",
    summary: "已找到相关资料。以下保留作者的原始摘要，供你逐条查看和判断。",
    summary_citations: [],
    sections: sources.slice(0, 5).map((source) => ({
      title: source.title,
      body: `${source.author || "该作者"}的内容摘要：${source.excerpt}`,
      citations: [source.id],
    })),
    limitations: [reason, "摘要不是完整原文，个人经历不能代表普遍共识。"],
  };
}

export function parseTextDraft(content: string): Draft | undefined {
  const trimmed = content.trim();
  // Invalid structured output must not escape citation validation as ordinary prose.
  if (!trimmed || /^(?:```(?:json)?\s*)?[\[{]/i.test(trimmed)) return;
  const body = plainText(trimmed)
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .slice(0, 20000);
  if (!body) return;
  return {
    format: "zhida_text",
    summary: "以下是知乎直答的综合回答，可结合帖子列表进一步核对。",
    summary_citations: [],
    sections: [{ title: "知乎直答", body, citations: [] }],
    limitations: [
      "这段直答没有提供可逐条核对的引用；检索帖子不能视为正文每项结论的证据。",
      ...(trimmed.length > 20000
        ? ["回答较长，此处仅展示前 20,000 字符。"]
        : []),
    ],
  };
}

export class ZhihuProvider implements KnowledgeProvider {
  async search(query: string, count = 5): Promise<Source[]> {
    const url = new URL(
      "https://developer.zhihu.com/api/v1/content/zhihu_search",
    );
    url.searchParams.set("Query", query);
    url.searchParams.set("Count", String(Number.isFinite(count) ? Math.min(10, Math.max(1, Math.floor(count))) : 5));
    const result = responseSchema.safeParse(await request(url.href));
    if (!result.success)
      throw new AppError("INVALID_RESPONSE", "搜索结果格式暂时无法读取。", 502);
    if (result.data.Code === 20001)
      throw new AppError("AUTH_INVALID", "资料服务的访问授权暂不可用。", 503);
    if (result.data.Code === 30001)
      throw new AppError(
        "RATE_LIMITED",
        "当前服务额度或频率受限，请稍后再试。",
        429,
      );
    if (result.data.Code !== 0)
      throw new AppError("SEARCH_FAILED", "搜索服务暂时没有完成请求。", 502);
    const searchData = searchDataSchema.safeParse(result.data.Data);
    if (!searchData.success)
      throw new AppError("INVALID_RESPONSE", "搜索结果缺少资料字段。", 502);
    return searchData.data.Items.filter(
      (item) =>
        isZhihuPostUrl(item.Url) &&
        ["answer", "article", "question"].includes(
          item.ContentType.toLowerCase(),
        ),
    ).map((item, index) => ({
      id: index + 1,
      content_id: item.ContentID ? `zhihu:${item.ContentID}` : "",
      channel: "zhihu",
      title: plainText(item.Title),
      author: plainText(item.AuthorName),
      type: item.ContentType,
      excerpt: plainText(item.ContentText).slice(0, 5000),
      url: item.Url,
      ...(item.CommentCount !== undefined ? { comment_count: item.CommentCount } : {}),
      ...(item.VoteUpCount !== undefined ? { vote_up_count: item.VoteUpCount } : {}),
      ...(item.EditTime &&
      item.EditTime > 0 &&
      item.EditTime * 1000 <= Date.now()
        ? { updated_at: new Date(item.EditTime * 1000).toISOString() }
        : {}),
    }));
  }
  async generate(session: Session, sources: Source[]): Promise<Draft> {
    const mode = process.env.ZHIHU_GENERATION_MODE || "auto";
    if (mode === "sources")
      return sourceDraft(
        sources,
        "当前使用真实来源摘要模式，本次没有调用直答生成综合回答。",
      );
    if (mode !== "auto")
      throw new AppError("CONFIGURATION", "直答模式配置无效。", 503);
    const result = await request(
      "https://developer.zhihu.com/v1/chat/completions",
      {
        method: "POST",
        body: JSON.stringify({
          model: process.env.ZHIHU_ANSWER_MODEL || "zhida-thinking-1p5",
          stream: false,
          messages: [
            {
              role: "system",
              content: ANSWER_INSTRUCTIONS,
            },
            {
              role: "user",
              // Repeat the output contract in the task message: Zhida may prioritize it over system text.
              content: `${ANSWER_INSTRUCTIONS}\n\n待整理的资料（JSON 数据）：\n${JSON.stringify(
                {
                  question: session.focused_question,
                  confirmed_context: session.confirmed_context,
                  sources: sources.map(
                    ({
                      id,
                      title,
                      excerpt,
                      author,
                      channel,
                      updated_at,
                      url,
                      relevance,
                    }) => ({
                      id,
                      title,
                      excerpt,
                      author,
                      channel,
                      updated_at,
                      url,
                      relevance,
                    }),
                  ),
                },
              )}\n\n现在只返回规定格式的 JSON 对象。`,
            },
          ],
        }),
      },
    );
    const response = z
      .object({
        choices: z
          .array(
            z.object({
              message: z.object({ content: z.string() }),
              finish_reason: z.string().nullable().optional(),
            }),
          )
          .min(1),
      })
      .safeParse(result);
    if (!response.success)
      throw new AppError(
        "INVALID_RESPONSE",
        "回答服务返回的内容无法读取。",
        502,
      );
    if (
      ["length", "error", "content_filter"].includes(
        response.data.choices[0].finish_reason || "",
      )
    )
      throw new AppError("INCOMPLETE", "回答未能完整生成，请手动重试。", 502);
    const content = response.data.choices[0].message.content;
    const draft = parseDraft(content, sources);
    if (draft) return { ...draft, format: "structured" };
    // Zhida documents text completions, not guaranteed JSON. Preserve prose without invented citations.
    const text = parseTextDraft(content);
    if (text) return text;
    return sourceDraft(
      sources,
      "结构化回答或引用校验未通过，已保留真实来源摘要。",
    );
  }
}
