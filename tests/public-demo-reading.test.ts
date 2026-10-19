import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEMO_TOPICS, demoClarification, demoReadingMap, demoSearchItems, getDemoSource, getDemoTopic, searchDemoTopics } from "../src/lib/reading/demo";
import { MAX_TURNS } from "../src/lib/reading/reading-intent";
import { demoRoundtableSources } from "../src/lib/roundtable/demo";

test("演示只搜索有限的原创样例，不为未知问题伪造结果", () => {
  assert.equal(DEMO_TOPICS.length, 3);
  assert.deepEqual(searchDemoTopics("最近的月球天气"), []);
  assert.deepEqual(demoSearchItems(""), []);
  assert.deepEqual(demoSearchItems("未知问题"), []);
  assert.equal(searchDemoTopics("我想比较第一台相机")[0]?.id, "demo-camera");
  assert.equal(searchDemoTopics("AI 工具自测")[0]?.id, "demo-ai-study");
  assert.equal(searchDemoTopics("转岗小项目")[0]?.id, "demo-career");
  assert.equal(searchDemoTopics("AI工具")[0]?.id, "demo-ai-study");
  assert.equal(demoRoundtableSources("AI工具").length, 4);
  for (const unrelated of ["daily news", "retail", "1AI", "AI2", "AI_工具", "工具_AI"]) {
    assert.deepEqual(searchDemoTopics(unrelated), [], unrelated);
    assert.deepEqual(demoSearchItems(unrelated), [], unrelated);
    assert.throws(() => demoRoundtableSources(unrelated), { code: "DEMO_TOPIC_REQUIRED" }, unrelated);
  }
  for (const topic of DEMO_TOPICS) {
    assert.equal(getDemoTopic(topic.id), topic);
    assert.equal(getDemoTopic(topic.title), topic);
    assert.equal(demoSearchItems(topic.title).length, topic.sources.length);
  }
});

test("材料显式标注示例、保留本地来源且不提供虚构热度", () => {
  const sources = DEMO_TOPICS.flatMap(topic => topic.sources);
  assert.equal(new Set(sources.map(source => source.ContentID)).size, sources.length);
  for (const source of sources) {
    assert.match(source.Title, /^\[示例\]/);
    assert.match(source.ContentText, /原创演示材料，非知乎内容/);
    assert.equal(source.Url, `/demo#${source.ContentID}`);
    assert.equal(source.VoteUpCount, 0);
    assert.equal(source.CommentCount, 0);
    assert.equal(source.EditTime, 0);
    assert.equal(getDemoSource(source.ContentID), source);
  }
  assert.equal(getDemoSource("unknown"), undefined);
  const copy = demoSearchItems(DEMO_TOPICS[0].title);
  copy[0].Title = "changed";
  assert.match(DEMO_TOPICS[0].sources[0].Title, /^\[示例\]/);
});

test("无模型时三个话题均有三轮明确示例追问和完整固定阅读路线", () => {
  for (const topic of DEMO_TOPICS) {
    const prompts = new Set<string>();
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const question = demoClarification(topic, turn);
      assert.match(question.prompt, /^\[示例追问\]/);
      assert.equal(question.options.length, 3);
      assert.equal(new Set(question.options.map(option => option.id)).size, 3);
      prompts.add(question.prompt);
    }
    assert.equal(prompts.size, MAX_TURNS);
    assert.throws(() => demoClarification(topic, MAX_TURNS), /INVALID_HISTORY/);
    const map = demoReadingMap(topic);
    assert.equal(map.demo, true);
    assert.equal(map.generation, "preset");
    assert.match(map.summary, /未根据回答重新生成/);
    assert.equal(map.categories.length, 4);
    assert.equal(new Set(map.categories.flatMap(category => category.posts.map(post => post.contentId))).size, 4);
    assert.deepEqual(map.searchHashIds, []);
  }
});

test("阅读接口隔离过期知乎凭据，并在配置 DeepSeek 时继续调用 AI", async t => {
  // Next replaces this build-time marker; Node route unit tests only need its empty runtime behavior.
  const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
    return specifier === "server-only" ? { url: "node:util", shortCircuit: true } : nextResolve(specifier, context);
  } });
  t.after(() => hooks.deregister());
  const saved = { ...process.env };
  t.after(() => { process.env = saved; });
  process.env.WENSHAN_PUBLIC_DEMO = "1";
  process.env.ZHIHU_ACCESS_SECRET = "expired-secret-that-must-not-be-used";
  delete process.env.DEEPSEEK_API_KEY;
  process.env.WENSHAN_DB_PATH = join(mkdtempSync(join(tmpdir(), "reading-demo-")), "sessions.sqlite");
  const outputs: unknown[] = [];
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    assert.equal(String(url), "https://api.deepseek.com/chat/completions");
    assert.ok(outputs.length, "Unexpected external request");
    calls.push(String(url));
    const output = outputs.shift();
    return output instanceof Response ? output : Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }] });
  });
  const [{ GET: discover }, { POST: clarify }, { POST: readingMap }, { POST: mindMap }, { GET: answers }] = await Promise.all([
    import("../src/app/api/reading/discovery/route"), import("../src/app/api/reading/clarify/route"),
    import("../src/app/api/reading/reading-map/route"), import("../src/app/api/reading/mind-map/route"),
    import("../src/app/api/reading/questions/[id]/answers/route"),
  ]);
  const request = (path: string, body: unknown) => new Request(`http://localhost/api/reading/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const topic = DEMO_TOPICS[0];
  const body = { questionId: topic.id, history: [] };
  const listing = await (await discover(new Request("http://localhost/api/reading/discovery"))).json();
  assert.equal(listing.questions.length, 3);
  assert.equal(listing.demo, true);
  const unknown = await (await discover(new Request("http://localhost/api/reading/discovery?q=月球天气"))).json();
  assert.deepEqual(unknown.questions, []);
  assert.equal((await (await answers(new Request("http://localhost"), { params: Promise.resolve({ id: topic.id }) })).json()).answers.length, 4);
  assert.equal((await (await clarify(request("clarify", body))).json()).generation, "preset");
  assert.equal((await (await readingMap(request("reading-map", body))).json()).generation, "preset");
  assert.equal((await (await mindMap(request("mind-map", { contentId: topic.sources[0].ContentID }))).json()).generation, "preset");
  assert.equal((await mindMap(request("mind-map", { contentId: "unknown", title: "test", excerpt: "test" }))).status, 404);
  assert.equal(calls.length, 0);

  process.env.DEEPSEEK_API_KEY = "mock-key";
  outputs.push(demoClarification(topic, 0));
  assert.equal((await clarify(request("clarify", body))).status, 200);
  outputs.push({ summary: "AI 根据需求安排示例路线", categories: topic.sources.map((source, index) => ({ categoryKey: `C${index + 1}`, phase: "阅读示例", theme: source.Title, summary: "仅为示例材料", reason: "围绕相机选择比较", searchQueries: ["相机", "相机实践"], readingFocus: ["具体使用场景"] })) });
  outputs.push({ summary: "AI 筛选结果", categories: topic.sources.map((_, index) => ({ categoryKey: `C${index + 1}`, reason: "结合用户需求与摘要", posts: [{ ref: `C${index + 1}S${index + 1}`, focus: "相机选择", reason: "依据这篇示例的具体内容安排阅读" }] })) });
  const generated = await readingMap(request("reading-map", body));
  assert.equal(generated.status, 200);
  const map = await generated.json();
  assert.equal(map.generation, "ai");
  assert.equal(map.categories.length, 4);
  assert.equal(new Set(map.categories.flatMap((category: { posts: Array<{ contentId: string }> }) => category.posts.map(post => post.contentId))).size, 4);
  outputs.push({ thesis: "按实际拍摄场景选择相机", branches: ["任务", "需求", "实践", "核验"].map(label => ({ label, points: ["只依据原创示例"] })) });
  assert.equal((await (await mindMap(request("mind-map", { contentId: topic.sources[0].ContentID }))).json()).generation, "ai");
  assert.equal(calls.length, 4);
  assert.equal(outputs.length, 0);

  const history = [{ prompt: "已经问过的问题", answer: "已经选择的回答" }];
  outputs.push(Response.json({}, { status: 401 }));
  const invalidKey = await clarify(request("clarify", { ...body, history }));
  assert.equal(invalidKey.status, 503);
  assert.match((await invalidKey.json()).error, /DeepSeek 密钥/);
  process.env.WENSHAN_DEMO_DAILY_AI_LIMIT = "1";
  for (const response of [
    await clarify(request("clarify", { ...body, history })),
    await readingMap(request("reading-map", { ...body, history })),
    await mindMap(request("mind-map", { contentId: topic.sources[1].ContentID })),
  ]) {
    assert.equal(response.status, 429);
    assert.match((await response.json()).error, /AI 体验次数已用完/);
  }
  assert.equal(calls.length, 5);
});
