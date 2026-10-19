import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const target = new URL(process.env.WENSHAN_TEST_URL || "http://127.0.0.1:3000");
assert.ok(["http:", "https:"].includes(target.protocol) && !target.username && !target.password,
  "WENSHAN_TEST_URL must be an HTTP(S) URL without credentials.");
const base = target.origin;
const cookies = new Map();
let writesAllowed = false;

async function request(path, { method = "GET", body, expected = 200, accept = "application/json", authenticated = true } = {}) {
  assert.ok(["GET", "HEAD"].includes(method) || writesAllowed,
    "Refusing writes: health must confirm demo mode with AI disabled first.");
  const response = await fetch(`${base}${path}`, {
    method,
    signal: AbortSignal.timeout(30000),
    headers: {
      Accept: accept,
      "Content-Type": "application/json",
      Origin: base,
      ...(authenticated && cookies.size ? { Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; ") } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  for (const header of response.headers.getSetCookie()) {
    const pair = header.split(";", 1)[0];
    const equals = pair.indexOf("=");
    if (equals > 0) cookies.set(pair.slice(0, equals), pair.slice(equals + 1));
  }
  assert.equal(response.status, expected, `${method} ${path}: unexpected HTTP status`);
  return response;
}
async function json(path, options) {
  return (await request(path, options)).json();
}
const post = (path, body, expected = 200) => json(path, { method: "POST", body, expected });

async function main() {
  // This is deliberately the first HTTP call. Never test mutations against an
  // AI-enabled or standard deployment, even if the caller supplies its URL.
  const health = await json("/api/health");
  assert.equal(health.status, "ok", "Health is not ready; no writes were sent.");
  assert.equal(health.mode, "demo", "Refusing writes: server must use WENSHAN_PUBLIC_DEMO=1.");
  assert.equal(health.aiEnabled, false, "Refusing writes: clear DEEPSEEK_API_KEY on the test server first.");
  writesAllowed = true;

  const page = await (await request("/demo", { accept: "text/html" })).text();
  assert.match(page, /原创示例/, "/demo must identify its original sample materials.");
  const discovery = await json("/api/reading/discovery");
  assert.equal(discovery.demo, true);
  assert.equal(discovery.questions.length, 3);
  const unrelated = await json(`/api/reading/discovery?q=${encodeURIComponent(`无关主题-${randomUUID()}`)}`);
  assert.equal(unrelated.questions.length, 0, "Unrelated queries must not fabricate sample results.");

  let firstPost;
  for (const question of discovery.questions) {
    const answers = await json(`/api/reading/questions/${encodeURIComponent(question.id)}/answers`);
    assert.equal(answers.demo, true);
    assert.ok(answers.answers.length > 0, "Every sample topic needs readable answers.");
    const clarification = await post("/api/reading/clarify", { questionId: question.id, history: [] });
    assert.equal(clarification.demo, true);
    assert.ok(clarification.prompt && clarification.options.length >= 3);
    const map = await post("/api/reading/reading-map", { questionId: question.id, history: [] });
    assert.equal(map.demo, true);
    const posts = map.categories.flatMap(category => category.posts);
    assert.ok(posts.length > 0, "Every sample topic needs a reading map.");
    assert.ok(posts.every(item => item.url.startsWith("/demo#")), "Sample maps must use local source links.");
    firstPost ??= posts[0];
  }

  const mindMap = await post("/api/reading/mind-map", {
    contentId: firstPost.contentId, title: firstPost.title, excerpt: firstPost.excerpt,
  });
  assert.equal(mindMap.demo, true);
  assert.ok(mindMap.mindMap.thesis && mindMap.mindMap.branches.length === 4);
  const stream = await request("/api/reading/reading-map", {
    method: "POST", accept: "application/x-ndjson",
    body: { questionId: discovery.questions[0].id, history: [] },
  });
  assert.match(stream.headers.get("content-type"), /application\/x-ndjson/);
  const events = (await stream.text()).trim().split("\n").map(line => JSON.parse(line));
  assert.equal(events.some(event => event.type === "error"), false, "Reading stream emitted an error.");
  assert.ok(events.some(event => event.type === "progress"));
  assert.equal(events.find(event => event.type === "result")?.result.demo, true,
    "Reading stream must deliver a demo result event.");
  const oauth = await json("/api/oauth/status");
  assert.equal(oauth.configured, false);
  assert.equal(oauth.loggedIn, false);

  // Start with an empty cookie jar and only operate on the session created here.
  let result = await post("/api/sessions", { question: "如何用小项目验证转岗方向？" }, 201);
  assert.equal(result.session.provider, "demo");
  assert.ok(cookies.has("wenshan_browser"), "Session creation must return a browser identity cookie.");
  const sessionPath = `/api/sessions/${result.session.session_id}`;
  await request(sessionPath, { expected: 404, authenticated: false });
  if (result.session.stage === "clarifying") result = await post(`${sessionPath}/clarifications`, {
    context_version: result.session.context_version, skip: true,
  });
  assert.equal(result.session.stage, "ready");
  await post(`${sessionPath}/answer`, {
    context_version: result.session.context_version, request_id: randomUUID(),
  }, 202);
  for (let attempt = 0; attempt < 40; attempt++) {
    result = await json(sessionPath);
    if (["completed", "error"].includes(result.session.stage)) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.equal(result.session.stage, "completed", "Q&A demo did not finish successfully.");
  assert.equal(result.session.provider, "demo");
  assert.equal(result.session.answers.length, 1);
  assert.equal(result.session.answers[0].evidence, "demo");
  assert.equal(result.session.answers[0].demo_generation, "local");
  assert.ok(result.session.answers[0].sources.length > 0);

  const camera = discovery.questions.find(question => question.id === "demo-camera");
  assert.ok(camera, "Discovery must include the camera sample.");
  let round = await post("/api/roundtables", { question: camera.title }, 201);
  assert.equal(round.provider, "demo");
  assert.ok(round.sources.length >= 4);
  const roundPath = `/api/roundtables/${round.id}`;
  round = await post(`${roundPath}/advance`, { expectedTurn: round.scheduler.turn });
  assert.ok(round.messages.some(message => message.phase === "statement"));
  round = await post(`${roundPath}/messages`, { content: "我主要拍摄日常生活，应该先验证哪些需求？" });
  assert.equal(round.messages.at(-2)?.speaker, "user");
  assert.equal(round.messages.at(-1)?.replyTo, round.messages.at(-2)?.id);
  assert.ok(round.sources.every(source => source.url.startsWith("/demo#")));
  console.log("Public demo HTTP smoke passed: safety gate, sample page, 3 reading topics, unknown search, clarification, maps, NDJSON, OAuth, Q&A, owner isolation, roundtable and user reply.");
}

await main().catch(error => {
  // Do not print environment values, cookies or full upstream response bodies.
  console.error("Public demo HTTP smoke failed:", error instanceof assert.AssertionError ? error.message : "HTTP request or response parsing failed.");
  process.exitCode = 1;
});
