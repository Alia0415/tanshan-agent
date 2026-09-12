import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createSession, clarify, updateContext, claimAnswer, runAnswer } from "../src/lib/server/sessions";
import { getSession } from "../src/lib/server/store";
import { planClarification, parseClarificationPlan, type ClarificationPlanner } from "../src/lib/server/clarification-planner";
import { AppError, clarifySchema } from "../src/lib/domain/validation";
import type { Session } from "../src/lib/domain/types";
import { buildQueries } from "../src/lib/domain/clarification";
import { receiveAgentMessage } from "../src/lib/agent/bridge";

process.env.WENSHAN_DB_PATH = join(mkdtempSync(join(tmpdir(), "wenshan-planner-")), "sessions.sqlite");
process.env.WENSHAN_PROVIDER = "live";
process.env.WENSHAN_CLARIFICATION_MODE = "deepseek";
process.env.DEEPSEEK_API_KEY = "unit-test-only";
const owner = "planner-tests";
const ask = (question = "你主要用相机拍什么？") => ({
  action: "ask", question, description: "用途会影响镜头选择。",
  options: ["旅行风景", "人像日常"], placeholder: "描述你常拍的场景",
});
const card = (question?: string) => parseClarificationPlan(JSON.stringify(ask(question)))!;
const completion = (plan: unknown, finish_reason = "stop") => Response.json({
  choices: [{ finish_reason, message: { content: JSON.stringify(plan) } }],
});
const initial = () => createSession("预算6000元，想买相机，怎么选？", owner, async () => card());

test("DeepSeek receives current facts and returns actual question-specific options", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    assert.equal(url, "https://api.deepseek.com/chat/completions");
    const body = JSON.parse(options.body as string);
    assert.equal(body.response_format.type, "json_object");
    assert.equal(body.thinking.type, "disabled");
    const data = JSON.parse(body.messages[1].content);
    assert.match(data.original_question, /6000/);
    assert.equal(data.remaining_rounds, 5);
    assert.equal(data.history.length, 0);
    return completion(ask());
  });
  const { session, auto_answer } = await createSession("预算6000元，想买相机，怎么选？", owner);
  assert.equal(session.clarification?.kind, "contextual");
  assert.deepEqual(session.clarification?.options, ["旅行风景", "人像日常"]);
  assert.equal(auto_answer, false);
  assert.ok(!JSON.stringify(session).includes("unit-test-only"));
});

test("facts can go straight to answering based on model decision", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => completion({ action: "answer" }));
  const result = await createSession("光合作用是什么？", owner);
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.equal(result.session.stage, "ready");
  assert.equal(result.auto_answer, true);
});

test("asking not to answer directly is not mistaken for an instruction to skip", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => completion(ask()));
  const result = await createSession("相机怎么选？不要直接回答，先了解我的需求", owner);
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.equal(result.session.stage, "clarifying");
});

test("five rounds is a hard cap even if the planner always wants another question", async () => {
  let calls = 0;
  const planner: ClarificationPlanner = async (session) => {
    calls++;
    assert.equal(session.clarification_history?.length, session.clarification_count);
    return card(`关于拍摄，你还需要明确第${calls}个条件吗？`);
  };
  let { session } = await createSession("相机怎么选？", owner, planner);
  for (let round = 1; round <= 5; round++) {
    const result = await clarify(session.session_id, owner, {
      context_version: session.context_version, selections: {}, free_text: `第${round}轮的具体回答`, skip: false,
    }, planner);
    session = result.session;
    assert.equal(session.clarification_count, round);
    assert.equal(result.auto_answer, round === 5);
  }
  assert.equal(calls, 5);
  assert.equal(session.stage, "ready");
  assert.equal(session.clarification, undefined);
  assert.equal(session.clarification_history?.length, 5);
  await assert.rejects(clarify(session.session_id, owner, {
    context_version: session.context_version, selections: {}, free_text: "多问一轮", skip: false,
  }, planner), (e: unknown) => e instanceof AppError && e.code === "INVALID_STAGE");
});

test("question and selected answer retain their meaning in the planner, search and final generation", async () => {
  const { session: first } = await initial();
  let observed: Session | undefined;
  const result = await clarify(first.session_id, owner, {
    context_version: 1, selections: {}, answer: "旅行风景", free_text: "主要徒步，不拍视频", skip: false,
  }, async (session) => { observed = structuredClone(session); return undefined; });
  assert.deepEqual(observed?.clarification_history, [{ question: first.clarification!.title, answer: "旅行风景；主要徒步，不拍视频" }]);
  assert.equal(result.auto_answer, true);
  assert.match(result.session.focused_question, /你主要用相机拍什么.*旅行风景/u);
  assert.ok(buildQueries(result.session).every((query) => query.includes("主要徒步")));
  const request = randomUUID();
  claimAnswer(first.session_id, owner, 2, request);
  let generated = false;
  await runAnswer(first.session_id, 2, request, {
    search: async () => [{ id: 1, content_id: "test", title: "测试帖子", author: "测试作者", type: "answer", url: "https://www.zhihu.com/question/1/answer/2", excerpt: "测试摘录" }],
    generate: async (session) => {
      assert.match(session.focused_question, /主要徒步/);
      generated = true;
      return { summary: "测试摘要", summary_citations: [1], sections: [], limitations: [] };
    },
  });
  assert.equal(generated, true);
});

test("skip and explicit refusal do not make another paid model request", async () => {
  for (const input of [{ skip: true }, { skip: false, free_text: "直接回答" }, { skip: false, free_text: "不知道" }]) {
    const { session } = await initial();
    const result = await clarify(session.session_id, owner, {
      context_version: 1, selections: {}, ...input,
    }, async () => { throw new Error("Planner must not be called"); });
    assert.equal(result.session.stage, "ready");
    assert.equal(result.auto_answer, true);
  }
});

test("no extra paid call for an initial explicit skip or at the round cap", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("No network allowed"); });
  assert.equal((await createSession("相机怎么选？直接回答", owner)).auto_answer, true);
  const { session } = await initial();
  session.clarification_count = 5;
  assert.equal(await planClarification(session), undefined);
});

test("unknown choices and empty submissions cannot become confirmed answers", async () => {
  const { session } = await initial();
  for (const input of [{ answer: "不存在的选项" }, {}]) {
    await assert.rejects(clarify(session.session_id, owner, {
      context_version: 1, selections: {}, skip: false, ...input,
    }), (e: unknown) => e instanceof AppError);
  }
  assert.equal(getSession(session.session_id, owner).context_version, 1);
  assert.equal(clarifySchema.safeParse({ context_version: 1, answer: "x".repeat(121) }).success, false);
});

test("model questions are never extracted as facts provided by the user", async () => {
  const { session } = await createSession("想拍照", owner, async () => card("你希望先整体了解相机，还是比较价格？"));
  const result = await clarify(session.session_id, owner, {
    context_version: 1, selections: {}, free_text: "旅行拍风景", skip: false,
  }, async () => undefined);
  assert.deepEqual(result.session.confirmed_context, { priorities: [] });
});

test("model failure preserves the previous card and version for retry or skip", async () => {
  const { session } = await initial();
  await assert.rejects(clarify(session.session_id, owner, {
    context_version: 1, selections: {}, answer: "旅行风景", skip: false,
  }, async () => { throw new AppError("CLARIFICATION_UNAVAILABLE", "暂不可用", 502); }));
  const current = getSession(session.session_id, owner);
  assert.equal(current.context_version, 1);
  assert.equal(current.clarification_count, 0);
  assert.deepEqual(current.clarification, session.clarification);
});

test("late planning cannot overwrite an edit made while the network call is pending", async () => {
  const { session } = await initial();
  let release!: () => void;
  const pending = clarify(session.session_id, owner, {
    context_version: 1, selections: {}, answer: "旅行风景", skip: false,
  }, async () => {
    await new Promise<void>((resolve) => { release = resolve; });
    return card("你能接受多重的相机？");
  });
  updateContext(session.session_id, owner, { context_version: 1, changes: { constraints: "最新预算9000元" } });
  release();
  await assert.rejects(pending, (e: unknown) => e instanceof AppError && e.code === "CONTEXT_CHANGED");
  assert.equal(getSession(session.session_id, owner).confirmed_context.constraints, "最新预算9000元");
});

test("malformed, incomplete and rate-limited model output never silently becomes a generic card", async (t) => {
  const { session } = await initial();
  const responses = [completion(ask(), "length"), completion({}), completion({ action: "ask", question: "预算？" }),
    new Response("private upstream details", { status: 401 }), new Response("private upstream details", { status: 429 })];
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => responses[calls++]);
  for (let i = 0; i < responses.length; i++) {
    await assert.rejects(planClarification(session), (e: unknown) => e instanceof AppError &&
      !e.message.includes("private upstream") && !e.message.includes("unit-test-only"));
  }
  assert.equal(calls, responses.length, "no automatic retries");
});

test("an exact repeated question stops instead of asking it again", async (t) => {
  const { session } = await initial();
  session.clarification_history = [{ question: card().title, answer: "旅行风景" }];
  t.mock.method(globalThis, "fetch", async () => completion(ask()));
  assert.equal(await planClarification(session), undefined);
});

test("text conversation exposes and resolves dynamically generated option numbers", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => completion(calls++ === 0 ? ask() : { action: "answer" }));
  const first = await receiveAgentMessage({ message: "相机怎么选？", request_id: randomUUID() }, owner);
  assert.match(first.text, /1. 旅行风景/);
  const second = await receiveAgentMessage({ message: "1", session_id: first.session_id, context_version: first.context_version, request_id: randomUUID() }, owner, {
    search: async () => [], generate: async () => { throw new Error("No sources, no generation"); },
  });
  assert.equal(second.stage, "completed");
  assert.match(getSession(first.session_id, owner).focused_question, /旅行风景/);
  assert.equal(calls, 2);
});
