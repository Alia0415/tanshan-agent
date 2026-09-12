import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const base = process.env.WENSHAN_TEST_URL || "http://127.0.0.1:3000";
let cookie = "";
async function request(
  path,
  method = "GET",
  body,
  expected = 200,
  authenticated = true,
) {
  const response = await fetch(`${base}${path}`, {
    method,
    signal: AbortSignal.timeout(30000),
    headers: {
      "Content-Type": "application/json",
      Origin: base,
      ...(authenticated && cookie ? { Cookie: cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (response.headers.get("set-cookie"))
    cookie = response.headers.get("set-cookie").split(";")[0];
  const data = await response.json();
  assert.equal(response.status, expected, JSON.stringify(data));
  return data;
}
let result = await request(
  "/api/sessions",
  "POST",
  { question: "如何评价远程办公？" },
  201,
);
assert.equal(
  result.session.provider,
  "demo",
  "Smoke test must run against demo mode; it never intentionally invokes paid APIs.",
);
const path = `/api/sessions/${result.session.session_id}`;
assert.equal(result.session.stage, "clarifying");
await request(path, "GET", undefined, 404, false);
result = await request(`${path}/clarifications`, "POST", {
  context_version: 1,
  selections: { purpose: "decide" },
});
assert.equal(result.session.clarification_count, 1);
result = await request(`${path}/clarifications`, "POST", {
  context_version: 2,
  selections: {
    scenario: "工作三年，准备换工作",
    priorities: ["实际体验", "长期影响"],
  },
});
assert.equal(result.session.stage, "ready");
assert.equal(result.session.clarification_count, 2);
const payload = { context_version: 3, request_id: randomUUID() };
await request(`${path}/answer`, "POST", payload, 202);
await request(`${path}/answer`, "POST", payload, 202);
for (let attempt = 0; attempt < 30; attempt++) {
  result = await request(path);
  if (result.session.stage === "completed" || result.session.stage === "error")
    break;
  await new Promise((resolve) => setTimeout(resolve, 400));
}
assert.equal(result.session.stage, "completed");
assert.equal(result.session.answers.length, 1);
assert.equal(result.session.answers[0].evidence, "demo");
assert.equal(result.session.answers[0].sources.length, 0);
const answerId = result.session.answers[0].id;
await request(`${path}/feedback`, "POST", {
  answer_id: answerId,
  type: "irrelevant",
  reason: "受控验收反馈",
});
result = await request(`${path}/context`, "PATCH", {
  context_version: 3,
  changes: { purpose: "solve" },
});
assert.equal(result.session.context_version, 4);
assert.equal(result.session.answers[0].context_version, 3);
assert.equal(result.session.stage, "ready");
await request(`${path}/answer`, "POST", payload, 409);
await request("/api/sessions", "POST", { question: " " }, 400);
const foreignOrigin = await fetch(`${base}/api/sessions`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: "https://example.invalid",
    Cookie: cookie,
  },
  body: JSON.stringify({ question: "跨站测试" }),
});
assert.equal(foreignOrigin.status, 403);
let agentReply = await request("/api/agent/messages", "POST", {
  message: "如何评价远程办公？",
  request_id: randomUUID(),
});
assert.equal(agentReply.stage, "clarifying");
agentReply = await request("/api/agent/messages", "POST", {
  message: "直接回答",
  session_id: agentReply.session_id,
  context_version: agentReply.context_version,
  request_id: randomUUID(),
});
assert.equal(agentReply.stage, "completed");
assert.equal(agentReply.answer.evidence, "demo");
assert.match(agentReply.text, /流程演示/);
console.log(
  "HTTP smoke passed: create, credential isolation, 2 rounds, answer idempotency, recovery, feedback, context version, old answer retention, input validation.",
);
