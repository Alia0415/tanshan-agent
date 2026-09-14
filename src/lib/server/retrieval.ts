import type { Session, Source, SearchInfo } from "../domain/types";
import { buildQueries } from "../domain/clarification";
import { filterZhihuPosts } from "../domain/sources";
import { AppError } from "../domain/validation";
import { deduplicate, type KnowledgeProvider } from "./providers";
import { modelJsonAvailable } from "./deepseek";
import { deepseekSearch, normalizeQuery, type SearchIntelligence, type SearchPlan, type SearchReview } from "./search-intelligence";
import { sourcePreference } from "./source-ranking";

export const MAX_SEARCH_CALLS = 3;
const DISPLAY_LIMIT = 5;

export function uniqueCandidates(sources: Source[]): Source[] {
  const texts = new Set<string>();
  return deduplicate(filterZhihuPosts(sources)).filter((source) => {
    const text = source.excerpt.replace(/\s/g, "");
    if (text.length < 80) return true;
    if (texts.has(text)) return false;
    texts.add(text);
    return true;
  }).map((source, i) => ({ ...source, id: i + 1 }));
}

export function selectReviewed(sources: Source[], review: SearchReview, nowMs = Date.now()): Source[] {
  const byId = new Map(sources.map((source) => [source.id, source]));
  const preferences = new Map(sources.map((source) => [source.id, sourcePreference(source, nowMs)]));
  const eligible = review.filter((item) => item.relevance >= 2 && item.constraint_fit !== "conflicts");
  const direct = eligible.filter((item) => item.relevance === 3);
  // Once there are enough direct matches, do not pad the list with weaker background material.
  return (direct.length >= 3 ? direct : eligible)
    .sort((a, b) => b.relevance - a.relevance ||
      Number(b.constraint_fit === "fits") - Number(a.constraint_fit === "fits") ||
      (preferences.get(b.id) ?? 0) - (preferences.get(a.id) ?? 0) || a.id - b.id)
    .flatMap((item) => {
      const source = byId.get(item.id);
      return source ? [{ ...source, relevance: {
        reason: item.note, evidence: item.evidence,
        match_level: item.relevance === 3 ? "direct" as const : "background" as const,
        ...(item.constraint_fit === "unknown" ? { caveat: "摘要未能确认所有条件，需结合原文核对。" } : {}),
      } }] : [];
    });
}

export async function retrieve(
  session: Session,
  provider: Pick<KnowledgeProvider, "search">,
  isCurrent: () => boolean = () => true,
  intelligence?: SearchIntelligence,
): Promise<{ sources: Source[]; queries: string[]; warnings: string[]; info: SearchInfo }> {
  const mode = process.env.WENSHAN_SEARCH_MODE || "auto";
  if (!["auto", "basic", "deepseek"].includes(mode))
    throw new AppError("CONFIGURATION", "搜索优化模式配置无效。", 503);
  // auto: any configured model credential (DeepSeek preferred, Zhihu fallback) enables planning + review.
  let model = intelligence || (mode !== "basic" && (mode === "deepseek" || modelJsonAvailable()) ? deepseekSearch : undefined);
  const warnings: string[] = [];
  const assertCurrent = () => {
    if (!isCurrent()) throw new AppError("CANCELLED", "本轮检索已取消。", 409);
  };
  let strategy: SearchInfo["strategy"] = model ? "semantic" : "basic";
  let plan: SearchPlan = {
    intent: session.original_question,
    requirements: [],
    queries: buildQueries(session),
    fallback_query: session.confirmed_context.topic || session.original_question.slice(0, 80),
  };
  assertCurrent();
  if (model) {
    try { plan = await model.plan(session); }
    catch {
      strategy = "fallback";
      model = undefined;
      warnings.push("检索词规划暂不可用，本次使用原问题和已填写条件搜索，尚未完成相关性筛选。");
    }
    assertCurrent();
  }
  const queries: string[] = [];
  const seen = new Set<string>();
  let candidates: Source[] = [];
  let successfulSearches = 0;
  let lastError: unknown;
  const search = async (query: string) => {
    assertCurrent();
    const normalized = normalizeQuery(query);
    if (!normalized || seen.has(normalized) || queries.length >= MAX_SEARCH_CALLS) return false;
    seen.add(normalized);
    queries.push(query);
    try {
      // Broader recall before review; only five selected posts are displayed.
      const result = await provider.search(query, model ? 10 : 5);
      assertCurrent();
      candidates = uniqueCandidates([...candidates, ...result]).slice(0, 30);
      successfulSearches++;
    } catch (error) {
      assertCurrent();
      if (error instanceof AppError && ["AUTH_REQUIRED", "AUTH_INVALID", "RATE_LIMITED"].includes(error.code)) throw error;
      lastError = error;
      warnings.push("部分资料未能获取，本次只覆盖已返回的内容。");
    }
    return true;
  };
  for (const query of plan.queries.slice(0, 2)) await search(query);
  if (!successfulSearches) throw lastError || new AppError("SEARCH_FAILED", "本次未能完成搜索。", 502);

  let reviewed = false;
  let selected = candidates;
  const screen = async () => {
    if (!model || !candidates.length) { selected = candidates; return; }
    assertCurrent();
    try {
      const review = await model.review(session, plan, candidates);
      assertCurrent();
      if (review.length < candidates.length)
        warnings.push("部分候选的筛选依据未通过原文校验，已跳过这些内容。");
      selected = selectReviewed(candidates, review);
      reviewed = true;
    } catch {
      assertCurrent();
      strategy = "fallback";
      model = undefined;
      warnings.push("本次相关性筛选未完成，未评估的帖子仅作候选资料，请核对是否适用。");
      // Preserve already-reviewed selections; never revive known rejected posts after a failure.
      if (!reviewed) selected = candidates;
    }
  };
  await screen();
  let expanded = false;
  if ((reviewed ? selected.filter((source) => source.relevance?.match_level === "direct").length < 3 : candidates.length === 0) && queries.length < MAX_SEARCH_CALLS) {
    const previousCount = candidates.length;
    expanded = await search(plan.fallback_query);
    if (expanded && candidates.length > previousCount) await screen();
  }
  assertCurrent();
  if (reviewed && !selected.length)
    warnings.push("已检索到候选帖子，但没有足够相关且符合已知条件的内容，未用不相关帖子凑数。");
  const sources = deduplicate(selected.slice(0, DISPLAY_LIMIT));
  return {
    sources, queries, warnings,
    info: { strategy, candidate_count: candidates.length, selected_count: sources.length, reviewed, expanded },
  };
}
