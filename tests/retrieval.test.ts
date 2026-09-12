import test from "node:test";
import assert from "node:assert/strict";
import type { Session, Source } from "../src/lib/domain/types";
import { AppError } from "../src/lib/domain/validation";
import { previewExcerpt, sourceSignals } from "../src/lib/domain/sources";
import { retrieve, selectReviewed, uniqueCandidates } from "../src/lib/server/retrieval";
import { deepseekSearch, parseSearchPlan, parseSearchReview, type SearchIntelligence, type SearchPlan } from "../src/lib/server/search-intelligence";
import { ZhihuProvider } from "../src/lib/server/providers";
import { sourcePreference } from "../src/lib/server/source-ranking";

process.env.WENSHAN_SEARCH_MODE = "basic";
const session: Session = {
  schema_version: 2, session_id: "test", original_question: "预算6000元，旅行拍照的相机怎么选？",
  focused_question: "旅行拍照", stage: "searching", context_version: 2, clarification_count: 1,
  confirmed_context: { priorities: [], constraints: "预算改为9000元" },
  free_text_context: ["预算改为9000元，只拍风景，不需要视频。"],
  clarification_history: [{ question: "主要拍什么？", answer: "旅行风景" }],
  answers: [], provider: "live", created_at: "2026-09-12", expires_at: "2026-09-13",
};
const plan: SearchPlan = {
  intent: "9000元的旅行摄影相机", requirements: ["9000元", "旅行风景"],
  queries: ["9000元 旅行摄影 相机", "9000元 轻便相机 使用体验"],
  fallback_query: "9000元 旅游拍照 相机 选购",
};
const post = (id: number, excerpt = `相机相关摘要${id}`): Source => ({
  id, content_id: `post-${id}`, title: `测试帖子${id}`, author: `作者${id}`, type: "answer",
  url: `https://www.zhihu.com/question/1/answer/${id}?utm_source=test`, excerpt,
});
const reviewItem = (source: Source, relevance = 3, constraint_fit: "fits" | "unknown" | "conflicts" = "fits") => ({
  id: source.id, relevance, constraint_fit, evidence: source.excerpt.slice(0, 40), note: "根据摘要判断的相关性。",
});
const intelligence: SearchIntelligence = {
  plan: async () => plan,
  review: async (_s, _p, sources) => sources.map((source) => reviewItem(source)),
};

test("planner receives all five turns and the latest correction without truncating the first answer", async (t) => {
  const history = Array.from({ length: 5 }, (_, i) => ({ question: `追问${i}`, answer: `回答${i}`.repeat(250) }));
  const sourceSession = { ...session, clarification_history: history, free_text_context: history.map((turn) => turn.answer).concat("最新预算9000元") };
  t.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit) => {
    const body = JSON.parse(options.body as string);
    const input = JSON.parse(body.messages[1].content);
    assert.deepEqual(input.history, history);
    assert.equal(input.supplements.at(-1), "最新预算9000元");
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(plan) } }] });
  });
  process.env.DEEPSEEK_API_KEY = "test-placeholder";
  const result = await deepseekSearch.plan(sourceSession);
  assert.ok(result.queries.every((query) => query.includes("9000") && !query.includes("6000")));
});

test("query plans deduplicate whitespace variants and reject oversize or invented fields", () => {
  assert.equal(parseSearchPlan(JSON.stringify({ ...plan, queries: ["9000元 相机", "9000元相机"] })).queries.length, 1);
  assert.throws(() => parseSearchPlan(JSON.stringify({ ...plan, queries: ["x".repeat(161)] })));
  assert.throws(() => parseSearchPlan(JSON.stringify({ ...plan, api_key: "injected" })));
});

test("review rejects fabricated IDs, missing items and duplicates, and omits unsupported quotes", () => {
  const sources = [post(1), post(2)];
  const items = sources.map((source) => reviewItem(source));
  assert.equal(parseSearchReview(JSON.stringify({ items }), sources).length, 2);
  for (const invalid of [items.slice(0, 1), [items[0], items[0]], [{ ...items[0], id: 99 }, items[1]]])
    assert.throws(() => parseSearchReview(JSON.stringify({ items: invalid }), sources));
  assert.deepEqual(parseSearchReview(JSON.stringify({ items: [{ ...items[0], evidence: "原文没有这句话" }, items[1]] }), sources), [items[1]]);
});

test("one unsupported quote does not discard the valid reviews or revive unreviewed candidates", async () => {
  const sources = [post(1), post(2), post(3), post(4)];
  const result = await retrieve(session, { search: async () => sources }, () => true, {
    ...intelligence, review: async (_s, _p, candidates) => parseSearchReview(JSON.stringify({ items: candidates.map((source) => ({ ...reviewItem(source), ...(source.id === 1 ? { evidence: "这是原文没有的改写" } : {}) })) }), candidates),
  });
  assert.deepEqual(result.sources.map((source) => source.content_id), ["post-2", "post-3", "post-4"]);
  assert.equal(result.info.strategy, "semantic");
  assert.ok(result.warnings.some((warning) => warning.includes("原文校验")));
});

test("selection removes keyword-only matches and explicit conflicts but retains uncertain useful sources", () => {
  const sources = [post(1, "远程控制软件测评"), post(2, "这款相机套机15000元"), post(3, "旅行相机重量与携带体验"), post(4, "预算9000元的旅行套机")];
  const result = selectReviewed(sources, [reviewItem(sources[0], 0), reviewItem(sources[1], 3, "conflicts"), reviewItem(sources[2], 3, "unknown"), reviewItem(sources[3], 3)]);
  assert.deepEqual(result.map((source) => source.content_id), ["post-4", "post-3"]);
  assert.ok(result[1].relevance?.caveat);
  assert.equal(result[0].excerpt, sources[3].excerpt);
});

test("retrieval requests ten candidates per query and keeps original links with contiguous final citation IDs", async () => {
  const counts: number[] = [];
  const results = [post(1), post(2), post(3), post(4), post(5), post(6)];
  const result = await retrieve(session, { search: async (_query, count) => { counts.push(count!); return results; } }, () => true, intelligence);
  assert.deepEqual(counts, [10, 10]);
  assert.equal(result.info.candidate_count, 6);
  assert.equal(result.sources.length, 5);
  assert.deepEqual(result.sources.map((source) => source.id), [1, 2, 3, 4, 5]);
  assert.equal(result.sources[0].url, results[0].url);
  assert.equal(result.info.expanded, false);
});

test("too few relevant posts trigger one complementary search even when the upstream returned many items", async () => {
  const calls: string[] = [];
  const model: SearchIntelligence = { ...intelligence, review: async (_s, _p, sources) => sources.map((source) => reviewItem(source, source.content_id === "post-9" ? 3 : 0)) };
  const result = await retrieve(session, { search: async (query) => { calls.push(query); return query === plan.fallback_query ? [post(9)] : [post(1), post(2), post(3)]; } }, () => true, model);
  assert.deepEqual(calls, [...plan.queries, plan.fallback_query]);
  assert.deepEqual(result.sources.map((source) => source.content_id), ["post-9"]);
  assert.equal(result.sources[0].id, 1);
  assert.equal(result.info.expanded, true);
});

test("enough direct matches are not padded with weaker background or promotional material", () => {
  const sources = [post(1), post(2), post(3), post(4), post(5)];
  const selected = selectReviewed(sources, sources.map((source) => reviewItem(source, source.id === 5 ? 2 : 3)));
  assert.equal(selected.length, 4);
  assert.ok(selected.every((source) => source.relevance?.match_level === "direct"));
});

test("entirely irrelevant results stay empty after the search budget instead of filling a list", async () => {
  let calls = 0;
  const result = await retrieve(session, { search: async () => [post(++calls)] }, () => true, {
    ...intelligence, review: async (_s, _p, sources) => sources.map((source) => reviewItem(source, 0)),
  });
  assert.equal(calls, 3);
  assert.deepEqual(result.sources, []);
  assert.ok(result.warnings.some((warning) => warning.includes("没有足够相关")));
});

test("quota and invalid credentials stop further searches and are never treated as empty results", async () => {
  for (const code of ["RATE_LIMITED", "AUTH_INVALID"]) {
    let calls = 0;
    await assert.rejects(retrieve(session, { search: async () => { calls++; throw new AppError(code, "controlled", 503); } }, () => true, intelligence), (e: unknown) => e instanceof AppError && e.code === code);
    assert.equal(calls, 1);
  }
});

test("failed planning falls back explicitly and does not retry a paid model call", async () => {
  let plans = 0;
  let reviews = 0;
  const result = await retrieve(session, { search: async () => [post(1)] }, () => true, {
    plan: async () => { plans++; throw new Error("private upstream details"); },
    review: async () => { reviews++; return []; },
  });
  assert.equal(plans, 1);
  assert.equal(reviews, 0);
  assert.equal(result.info.strategy, "fallback");
  assert.equal(result.info.reviewed, false);
  assert.ok(!JSON.stringify(result).includes("private upstream"));
});

test("failed second review never revives posts already rejected by the first review", async () => {
  let searches = 0;
  let reviews = 0;
  const result = await retrieve(session, { search: async () => searches++ < 2 ? [post(1), post(2)] : [post(3)] }, () => true, {
    ...intelligence, review: async (_s, _p, sources) => {
      if (reviews++) throw new Error("controlled outage");
      return sources.map((source) => reviewItem(source, source.content_id === "post-1" ? 3 : 0));
    },
  });
  assert.equal(result.info.strategy, "fallback");
  assert.deepEqual(result.sources.map((source) => source.content_id), ["post-1"]);
});

test("obsolete sessions stop before search, review or fallback can make more calls", async () => {
  let current = true;
  let calls = 0;
  await assert.rejects(retrieve(session, { search: async () => { calls++; current = false; return [post(1)]; } }, () => current, intelligence), (e: unknown) => e instanceof AppError && e.code === "CANCELLED");
  assert.equal(calls, 1);
});

test("repeated fallback queries and duplicate content do not consume extra calls or slots", async () => {
  let calls = 0;
  const model = { ...intelligence, plan: async () => ({ ...plan, queries: ["相机 旅行", "相机旅行"], fallback_query: "相机 旅行" }) };
  const result = await retrieve(session, { search: async () => { calls++; return [post(1), post(1)]; } }, () => true, model);
  assert.equal(calls, 1);
  assert.equal(result.sources.length, 1);
  assert.equal(uniqueCandidates([post(1, "相同正文".repeat(40)), post(2, "相同正文".repeat(40)), { ...post(3), url: "https://example.com/post" }]).length, 1);
});

test("relevant snippet preview uses actual text around evidence instead of an unrelated introduction", () => {
  const source = { ...post(1, "前言".repeat(200) + "这是与旅行相机重量有关的原文。" + "结尾".repeat(100)), relevance: { reason: "相关", evidence: "这是与旅行相机重量有关的原文。" } };
  assert.match(previewExcerpt(source), /这是与旅行相机重量有关的原文/);
  assert.ok(previewExcerpt(source).startsWith("…"));
});

test("Zhihu recall count stays within the documented maximum of ten", async (t) => {
  process.env.ZHIHU_ACCESS_SECRET = "test-placeholder";
  const counts: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => {
    counts.push(new URL(input).searchParams.get("Count")!);
    return Response.json({ Code: 0, Data: { Items: [] } });
  });
  await new ZhihuProvider().search("相机", 100);
  await new ZhihuProvider().search("相机");
  assert.deepEqual(counts, ["10", "5"]);
});

const rankingNow = Date.parse("2026-09-12T12:00:00Z");
test("comments, upvotes and recency each improve rank within the same relevance and constraint tier", () => {
  const baseline = { ...post(1), comment_count: 2, vote_up_count: 10, updated_at: "2024-01-01T00:00:00Z" };
  for (const improvement of [
    { comment_count: 200 }, { vote_up_count: 1000 }, { updated_at: "2026-09-01T00:00:00Z" },
  ]) {
    const better = { ...baseline, ...post(2), ...improvement };
    const sources = [baseline, better];
    assert.deepEqual(selectReviewed(sources, sources.map((s) => reviewItem(s)), rankingNow).map((s) => s.content_id), ["post-2", "post-1"]);
  }
});

test("popularity cannot rescue conflicts or displace more relevant and better matched posts", () => {
  const popular = { comment_count: 100000, vote_up_count: 1000000, updated_at: "2026-09-12T11:00:00Z" };
  const sources = [post(1), { ...post(2), ...popular }, post(3), { ...post(4), ...popular }, { ...post(5), ...popular }];
  const reviewed = [reviewItem(sources[0]), reviewItem(sources[1], 3, "unknown"), reviewItem(sources[2]), reviewItem(sources[3], 3, "conflicts"), reviewItem(sources[4], 1)];
  assert.deepEqual(selectReviewed(sources, reviewed, rankingNow).map((s) => s.content_id), ["post-1", "post-3", "post-2"]);
  // With too few direct matches, useful background may remain, but cannot jump ahead on heat.
  assert.deepEqual(selectReviewed(sources.slice(0, 2), [reviewItem(sources[0]), reviewItem(sources[1], 2)], rankingNow).map((s) => s.content_id), ["post-1", "post-2"]);
});

test("ranking has diminishing engagement returns and balances recent discussion against old high totals", () => {
  const old = { ...post(1), comment_count: 1000, vote_up_count: 10000, updated_at: "2010-01-01T00:00:00Z" };
  const recent = { ...post(2), comment_count: 500, vote_up_count: 5000, updated_at: "2026-09-01T00:00:00Z" };
  assert.ok(sourcePreference(recent, rankingNow) > sourcePreference(old, rankingNow));
  assert.equal(sourcePreference({ ...old, comment_count: 100000, vote_up_count: 1000000 }, rankingNow), sourcePreference(old, rankingNow));
});

test("unknown or invalid metadata earns no fabricated bonus and equal ranks stay stable", () => {
  for (const signals of [
    {}, { comment_count: -1, vote_up_count: NaN, updated_at: "bad-date" },
    { comment_count: Infinity, vote_up_count: 1.5, updated_at: "2099-01-01T00:00:00Z" },
  ]) assert.equal(sourcePreference({ ...post(1), ...signals }, rankingNow), 0);
  const sources = [post(1), post(2)];
  assert.deepEqual(selectReviewed(sources, sources.map((s) => reviewItem(s)), rankingNow).map((s) => s.content_id), ["post-1", "post-2"]);
  assert.equal(sourceSignals(post(1)), "");
  assert.equal(sourceSignals({ ...post(1), comment_count: 0, vote_up_count: 1200, updated_at: "2026-09-01T00:00:00Z" }), "0 评论 · 1,200 赞同 · 更新于 2026-09-01");
});

test("ranked top five retain real counts and get continuous citation IDs after selection", async () => {
  const sources = Array.from({ length: 6 }, (_, i) => ({ ...post(i + 1), comment_count: i * 10, vote_up_count: i * 100 }));
  const result = await retrieve(session, { search: async () => sources }, () => true, intelligence);
  assert.deepEqual(result.sources.map((s) => s.content_id), ["post-6", "post-5", "post-4", "post-3", "post-2"]);
  assert.deepEqual(result.sources.map((s) => s.id), [1, 2, 3, 4, 5]);
  assert.equal(result.sources[0].comment_count, 50);
  assert.equal(result.sources[0].vote_up_count, 500);
  assert.equal(result.sources[0].url, sources[5].url);
});

test("Zhihu metadata preserves zero and distinguishes absent or invalid counts without losing posts", async (t) => {
  process.env.ZHIHU_ACCESS_SECRET = "test-placeholder";
  const items = [
    { CommentCount: 0, VoteUpCount: 120, EditTime: 1700000000 },
    {}, { CommentCount: -1, VoteUpCount: null, EditTime: "invalid" },
    { CommentCount: "999", VoteUpCount: 1.5, EditTime: 9999999999999 },
  ].map((metadata, i) => ({ Title: `帖子${i}`, ContentType: "Answer", ContentID: String(i + 1), ContentText: "原文", Url: `https://www.zhihu.com/answer/${i + 1}`, AuthorName: "作者", ...metadata }));
  t.mock.method(globalThis, "fetch", async () => Response.json({ Code: 0, Data: { Items: items } }));
  const sources = await new ZhihuProvider().search("虚构测试");
  assert.equal(sources.length, 4);
  assert.equal(sources[0].comment_count, 0);
  assert.equal(sources[0].vote_up_count, 120);
  assert.equal(sources[0].updated_at, "2023-11-14T22:13:20.000Z");
  for (const source of sources.slice(1)) {
    assert.equal(source.comment_count, undefined);
    assert.equal(source.vote_up_count, undefined);
    assert.equal(source.updated_at, undefined);
  }
});
