// Explicit live check: synthetic questions only; never print the local key.
import { loadEnvFile } from "node:process";
import assert from "node:assert/strict";
import { planClarification } from "../src/lib/server/clarification-planner";
import { extractContext, mergeContext } from "../src/lib/domain/clarification";
import type { Session } from "../src/lib/domain/types";

loadEnvFile(".env.local");
process.env.WENSHAN_CLARIFICATION_MODE = "deepseek";
function session(question: string): Session {
  return {
    schema_version: 2, session_id: "verification-only", original_question: question,
    stage: "understanding", context_version: 1, clarification_count: 0,
    confirmed_context: mergeContext({ priorities: [] }, extractContext(question)),
    free_text_context: [], clarification_history: [], focused_question: question,
    answers: [], provider: "demo", created_at: new Date().toISOString(), expires_at: new Date().toISOString(),
  };
}

async function main() {
  for (const question of ["要不要从大公司去创业公司？", "预算6000元，想买相机，应该怎么选？", "和室友作息不同，怎么办？", "光合作用是什么？"]) {
    const started = Date.now();
    const context = session(question);
    const card = await planClarification(context);
    console.log(JSON.stringify({ question, elapsed_ms: Date.now() - started, action: card ? "ask" : "answer", card }));
    if (question === "光合作用是什么？") assert.equal(card, undefined);
    else assert.equal(card?.kind, "contextual");
    if (question.startsWith("预算") && card) {
      const answer = "主要是徒步旅行拍风景，只拍照片，不拍视频，希望轻便，接受二手，完全新手。";
      context.clarification_history = [{ question: card.title, answer }];
      context.free_text_context = [`关于「${card.title}」：${answer}`];
      context.clarification_count = 1;
      const next = await planClarification(context);
      console.log(JSON.stringify({ followup_to: question, supplied_answer: answer, action: next ? "ask" : "answer", card: next }));
      assert.notEqual(next?.title, card.title);
    }
  }
}
main().catch((error) => {
  console.error(JSON.stringify({ error: error instanceof Error ? error.name : "Error", code: error?.code || "LIVE_CHECK_FAILED" }));
  process.exitCode = 1;
});
