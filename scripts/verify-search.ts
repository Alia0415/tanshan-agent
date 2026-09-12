// Explicit, paid live check. Synthetic user scenarios; never print credentials.
import assert from "node:assert/strict";
import { loadEnvFile } from "node:process";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { buildQueries, extractContext, mergeContext, focusQuestion } from "../src/lib/domain/clarification";
import { AppError } from "../src/lib/domain/validation";
import type { Session, Source } from "../src/lib/domain/types";
import { ZhihuProvider } from "../src/lib/server/providers";
import { retrieve, selectReviewed } from "../src/lib/server/retrieval";
import { deepseekSearch, type SearchPlan } from "../src/lib/server/search-intelligence";

function makeSession(question: string, supplements: string[]): Session {
  const session: Session = {
    schema_version: 2, session_id: randomUUID(), original_question: question,
    focused_question: question, stage: "searching", context_version: 1,
    clarification_count: supplements.length,
    confirmed_context: mergeContext({ priorities: [] }, extractContext(question)),
    free_text_context: supplements, clarification_history: [], answers: [], provider: "live",
    created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 86400000).toISOString(),
  };
  session.focused_question = focusQuestion(session);
  return session;
}

async function main() {
  loadEnvFile(".env.local");
  process.env.WENSHAN_SEARCH_MODE = "deepseek";
  const provider = new ZhihuProvider();
  const reports = [];
  for (const session of [
    makeSession("远程办公的实际体验怎么样？", ["我想了解员工在家工作的协作和生活体验，不是远程控制软件。"]),
    makeSession("预算6000元，想买相机，应该怎么选？", ["主要徒步旅行拍风景，只拍照片，希望轻便；6000元包括镜头。"]),
  ]) {
    const started = Date.now();
    const baselineQuery = buildQueries(session)[0];
    const baseline = await provider.search(baselineQuery, 5);
    let capturedPlan: SearchPlan | undefined;
    const assessed: unknown[] = [];
    const result = await retrieve(session, provider, () => true, {
      plan: async (input) => { capturedPlan = await deepseekSearch.plan(input); return capturedPlan; },
      review: async (input, plan, sources) => {
        const review = await deepseekSearch.review(input, plan, sources);
        assessed.push(sources.map((source) => ({ ...source, assessment: review.find((item) => item.id === source.id) })));
        return review;
      },
    });
    const report = { question: session.original_question, supplements: session.free_text_context,
      baseline_query: baselineQuery, baseline, plan: capturedPlan, ...result, assessed, elapsed_ms: Date.now() - started };
    reports.push(report);
    mkdirSync(".data", { recursive: true });
    writeFileSync(".data/search-quality-check.json", JSON.stringify({ checked_at: new Date().toISOString(), reports }, null, 2));
    console.log(JSON.stringify({ question: report.question, queries: result.queries, info: result.info,
      baseline_titles: baseline.map((source) => source.title),
      selected: result.sources.map((source) => ({ title: source.title, comments: source.comment_count, votes: source.vote_up_count, updated_at: source.updated_at, note: source.relevance?.reason })),
      warnings: result.warnings, elapsed_ms: report.elapsed_ms }));
    assert.equal(result.info.strategy, "semantic", "Model planning and review must complete");
    assert.ok(result.info.reviewed && result.sources.length > 0);
  }

  // Live semantic regression on controlled evidence, independent of changing search results.
  const fixture = makeSession("总预算6000元，旅行拍风景要轻便，只拍照片，相机怎么选？", []);
  const plan: SearchPlan = { intent: fixture.original_question, requirements: ["含镜头6000元", "轻便", "旅行风景"], queries: ["6000元 旅行相机"], fallback_query: "6000元 轻便相机 选购" };
  const texts = [
    "这款监控摄像头支持夜间安防和手机远程控制，适合家庭防盗。",
    "推荐这套旅行摄影装备，机身和镜头合计15000元，且没有更便宜的替代方案。",
    "徒步拍风光时应考虑机身和镜头的总重量，建议先租用或到店试背，本文不提供当前价格。",
    "旅行拍风景，不拍视频。我这套轻便相机加镜头当时总共花了5500元，出门只带一个变焦镜头。",
  ];
  const sources: Source[] = texts.map((excerpt, i) => ({ id: i + 1, content_id: `fixture-${i}`, title: `受控测试资料${i + 1}`, author: "虚构测试作者", type: "answer", url: `https://www.zhihu.com/question/1/answer/${i + 1}`, excerpt }));
  const review = await deepseekSearch.review(fixture, plan, sources);
  const ids = selectReviewed(sources, review).map((source) => source.id);
  assert.ok(!ids.includes(1) && !ids.includes(2) && ids.includes(3) && ids.includes(4));
  console.log(JSON.stringify({ semantic_fixture: "passed", retained_ids: ids, review }));
  console.log("Live search checks passed. Inspect .data/search-quality-check.json; this small check is not a general accuracy benchmark.");
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ ok: false, code: error instanceof AppError ? error.code : "SEARCH_CHECK_FAILED", type: error instanceof Error ? error.name : "Unknown" }));
  process.exitCode = 1;
});
