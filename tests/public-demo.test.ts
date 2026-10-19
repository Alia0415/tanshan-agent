import assert from "node:assert/strict";
import test from "node:test";
import type { Session } from "../src/lib/domain/types";
import { generateDemoAnswer, selectDemoSources } from "../src/lib/server/demo-answer";
import { assertUpstreamUrl } from "../src/lib/server/upstream";
import { modelJsonAvailable } from "../src/lib/server/deepseek";

const session = { focused_question: "第一台相机如何选？", original_question: "第一台相机如何选？",
  confirmed_context: { priorities: ["实际体验"] }, free_text_context: [] } as unknown as Session;

test("公开样例模式封锁知乎，DeepSeek可用性只取决于它自己的key", () => {
  const saved = { ...process.env };
  try {
    process.env.WENSHAN_PUBLIC_DEMO = "1";
    process.env.ZHIHU_ACCESS_SECRET = "expired-test-secret";
    delete process.env.DEEPSEEK_API_KEY;
    assert.equal(modelJsonAvailable(), false);
    for (const url of ["https://developer.zhihu.com/v1/chat/completions", "https://openapi.zhihu.com/authorize"])
      assert.throws(() => assertUpstreamUrl(url), { code: "PUBLIC_DEMO_OFFLINE" });
    process.env.DEEPSEEK_API_KEY = "test-only-key";
    assert.equal(modelJsonAvailable(), true);
    assert.equal(assertUpstreamUrl("https://api.deepseek.com/chat/completions"), "https://api.deepseek.com/chat/completions");
    assert.throws(() => assertUpstreamUrl("http://api.deepseek.com/chat/completions"), { code: "UPSTREAM_URL" });
  } finally { process.env = saved; }
});

test("有key时基于选定样例生成，未知引用被拒绝，不冒充真实知乎来源", async () => {
  const saved = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "test-only-key";
  try {
    const sources = selectDemoSources(session.original_question);
    assert.equal(sources.length, 4);
    assert.ok(sources.every(source => source.url.startsWith("/demo#") && source.title.includes("示例")));
    let calls = 0;
    const result = await generateDemoAnswer(session, sources, async options => {
      calls++;
      assert.match(options.instructions, /绝不是知乎帖子/);
      assert.equal(options.feature, "ANSWER");
      return JSON.stringify({ summary: "先确认拍摄场景", summary_citations: [1], sections: [{ title: "先试用", body: "以同一场景比较操作", citations: [4] }], limitations: [] });
    });
    assert.equal(calls, 1);
    assert.match(result.limitations[0], /原创预置样例/);
    await assert.rejects(generateDemoAnswer(session, sources, async () => JSON.stringify({ summary: "无效引用", summary_citations: [99], sections: [{ title: "错误", body: "不应展示", citations: [99] }], limitations: [] })), { code: "ANSWER_INVALID" });
    assert.deepEqual(selectDemoSources("这个样例库未收录的天文话题"), []);
  } finally { if (saved === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = saved; }
});

test("无key时使用标明规则的分析框架，不调用模型", async () => {
  const saved = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    const result = await generateDemoAnswer(session, [], async () => { throw new Error("不应请求模型"); });
    assert.match(result.summary, /本地规则/);
    assert.deepEqual(result.summary_citations, []);
  } finally { if (saved !== undefined) process.env.DEEPSEEK_API_KEY = saved; }
});
