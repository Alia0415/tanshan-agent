import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { ZhihuProvider, deduplicate } from "../src/lib/server/providers";
import { AppError } from "../src/lib/domain/validation";
import type { Session } from "../src/lib/domain/types";

// Explicit live check: two searches and one generation. Never run automatically in CI.
// Only status/counts are logged; secrets and response bodies are not printed.
async function main() {
  const envFile = resolve(import.meta.dirname, "../.env.local");
  if (existsSync(envFile)) loadEnvFile(envFile);
  if (!process.env.ZHIHU_ACCESS_SECRET?.trim()) {
    throw new AppError(
      "AUTH_REQUIRED",
      "请先在 .env.local 中填写 ZHIHU_ACCESS_SECRET。",
      503,
    );
  }
  const provider = new ZhihuProvider();
  const query = "远程办公有哪些实际体验？";
  const started = Date.now();
  const zhihu = await provider.search(query, "zhihu");
  console.log(
    JSON.stringify({
      capability: "zhihu_search",
      ok: true,
      sources: zhihu.length,
    }),
  );
  const global = await provider.search("远程办公 官方指南", "global");
  console.log(
    JSON.stringify({
      capability: "global_search",
      ok: true,
      sources: global.length,
    }),
  );
  const sources = deduplicate([...zhihu, ...global]).slice(0, 6);
  if (!sources.length) {
    throw new AppError(
      "NO_EVIDENCE",
      "两个搜索接口均未返回可用来源，未调用直答；请先检查搜索权限与结果。",
      502,
    );
  }
  const session: Session = {
    schema_version: 2,
    session_id: randomUUID(),
    original_question: query,
    focused_question: query,
    stage: "generating",
    context_version: 1,
    clarification_count: 0,
    confirmed_context: { purpose: "understand", priorities: ["实际体验"] },
    free_text_context: [],
    answers: [],
    provider: "live",
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400000).toISOString(),
  };
  if (process.env.ZHIHU_GENERATION_MODE === "sources") {
    console.log(
      JSON.stringify({
        capability: "zhida",
        skipped: true,
        reason: "sources_mode",
      }),
    );
    console.log("真实搜索接口验证通过；当前来源摘要模式不调用直答。");
    return;
  }
  const answer = await provider.generate(session, sources);
  const generated =
    answer.format === "structured" || answer.format === "zhida_text";
  const structured = answer.format === "structured";
  console.log(
    JSON.stringify({
      capability: "zhida",
      api_ok: generated,
      format: answer.format,
      structured_answer: structured,
      sections: answer.sections.length,
      summary_characters: answer.summary.length,
      total_elapsed_ms: Date.now() - started,
    }),
  );
  if (!generated) {
    throw new AppError(
      "ANSWER_FORMAT",
      "直答接口已返回，但结构化回答或引用校验未通过，已降级为真实摘要。",
      502,
    );
  }
  console.log(
    "知乎搜索、全网搜索和直答接口验证通过。普通直答文本与带来源编号的结构化回答分别展示。",
  );
}

main().catch((error: unknown) => {
  if (error instanceof AppError) {
    console.error(
      JSON.stringify({ ok: false, code: error.code, message: error.message }),
    );
  } else {
    console.error(
      JSON.stringify({
        ok: false,
        code: "CHECK_FAILED",
        message: "接口验证未完成；未输出可能含敏感信息的原始错误。",
      }),
    );
  }
  process.exitCode = 1;
});
