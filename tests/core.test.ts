import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildQueries,
  extractContext,
  mergeContext,
} from "../src/lib/domain/clarification";
import {
  answerSchema,
  clarifySchema,
  contextSchema,
  createSchema,
  AppError,
} from "../src/lib/domain/validation";
import {
  claimAnswer,
  clarify,
  createSession,
  runAnswer,
  updateContext,
  addFeedback,
} from "../src/lib/server/sessions";
import { getSession, db, cleanup, listSessions, insertSession, deleteSession } from "../src/lib/server/store";
import {
  deduplicate,
  parseDraft,
  ZhihuProvider,
  type Draft,
  type KnowledgeProvider,
} from "../src/lib/server/providers";
import type { Answer, Source } from "../src/lib/domain/types";
import { isZhihuPostUrl } from "../src/lib/domain/sources";

process.env.WENSHAN_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "wenshan-test-")),
  "sessions.sqlite",
);
process.env.WENSHAN_PROVIDER = "live";
process.env.WENSHAN_CLARIFICATION_MODE = "local";
process.env.WENSHAN_SEARCH_MODE = "basic";
const owner = "browser-owner";
const source: Source = {
  id: 1,
  content_id: "example-1",
  title: "测试摘要",
  author: "测试作者",
  type: "Answer",
  url: "https://www.zhihu.com/question/1/answer/2?utm_source=test",
  excerpt: "仅用于受控测试的摘要。",
};
const draft: Draft = {
  summary: "测试结论",
  summary_citations: [1],
  sections: [{ title: "测试维度", body: "测试正文", citations: [1] }],
  limitations: ["仅为测试。"],
};
const provider: KnowledgeProvider = {
  search: async () => [source],
  generate: async () => draft,
};
const start = async (question = "远程办公的实际体验怎么样？") =>
  (await createSession(question, owner)).session;

test("history isolates owners, omits expired sessions and returns newest summaries first", async () => {
  const token = randomUUID();
  const initial = await start();
  const answer: Answer = {
    ...draft, id: randomUUID(), context_version: initial.context_version,
    context: initial.confirmed_context, focused_question: initial.focused_question,
    sources: [source], queries: [], evidence: "sources", created_at: initial.created_at,
  };
  const base = { ...initial, stage: "completed" as const, answers: [answer] };
  const earlier = { ...base, session_id: randomUUID(), created_at: new Date(Date.now() - 10000).toISOString() };
  const newer = { ...base, session_id: randomUUID(), created_at: new Date().toISOString() };
  insertSession(earlier, token);
  insertSession(newer, token);
  insertSession({ ...base, session_id: randomUUID(), expires_at: new Date(Date.now() - 1).toISOString() }, token);
  // Abandoned drafts and completed searches without posts are not history.
  const unfinished = { ...initial, session_id: randomUUID() };
  insertSession(unfinished, token);
  insertSession({ ...base, session_id: randomUUID(), answers: [{ ...answer, sources: [] }] }, token);
  insertSession({ ...base, session_id: randomUUID(), answers: [{ ...answer, sources: [{ ...source, url: "https://example.com/post" }] }] }, token);
  // Editing conditions after a successful search must not lose that history.
  const edited = { ...base, session_id: randomUUID(), stage: "ready" as const, context_version: 2, created_at: new Date(Date.now() - 20000).toISOString() };
  insertSession(edited, token);
  const history = listSessions(token);
  assert.deepEqual(history.map((item) => item.session_id), [newer.session_id, earlier.session_id, edited.session_id]);
  assert.equal("answers" in history[0], false);
  assert.equal(getSession(unfinished.session_id, token).session_id, unfinished.session_id);
  assert.deepEqual(listSessions(randomUUID()), []);
  assert.equal(getSession(newer.session_id, token).original_question, base.original_question);
  assert.throws(() => getSession(newer.session_id, "different-owner"), AppError);
});

test("general questions ask purpose across domains without inventing profile fields", async () => {
  for (const question of [
    "如何评价远程办公？",
    "如何评价中山大学？",
    "和室友一起生活怎么样？",
    "想了解相机摄影",
  ]) {
    const session = await start(question);
    assert.equal(session.stage, "clarifying", question);
    assert.deepEqual(session.clarification?.fields, ["purpose"]);
    assert.deepEqual(session.confirmed_context, { priorities: [] });
  }
});

test("clear questions and explicit priorities skip clarification", async () => {
  for (const question of [
    "远程办公的实际体验怎么样？",
    "北京在哪个城市圈？直接回答",
    "光合作用是什么？",
    "预算 6000 元，想买一台旅行相机",
    "先整体介绍一下中山大学，不要追问",
  ]) {
    assert.equal((await createSession(question, owner)).auto_answer, true, question);
  }
  assert.deepEqual(extractContext("预算 6000 元，想买一台旅行相机"), {
    priorities: ["成本与投入"],
  });
});

test("two generic rounds retain scenario and limit search to two focused queries", async () => {
  const initial = await start("如何评价远程办公？");
  const first = (await clarify(initial.session_id, owner, {
    context_version: 1,
    selections: { purpose: "decide" },
    skip: false,
  })).session;
  assert.deepEqual(first.clarification?.fields, ["scenario", "priorities"]);
  const final = (await clarify(initial.session_id, owner, {
    context_version: 2,
    selections: {
      scenario: "工作三年，准备换工作",
      priorities: ["实际体验", "长期影响"],
    },
    skip: false,
  })).session;
  assert.equal(final.clarification_count, 2);
  assert.equal(final.stage, "ready");
  assert.equal(final.clarification, undefined);
  assert.equal(buildQueries(final).length, 2);
  assert.ok(buildQueries(final).every((query) => query.includes("准备换工作")));
});

test("skip or overview immediately authorizes an answer", async () => {
  for (const selections of [{}, { purpose: "overview" as const }]) {
    const session = await start("如何评价远程办公？");
    const result = await clarify(session.session_id, owner, {
      context_version: 1,
      selections,
      skip: !Object.keys(selections).length,
    });
    assert.equal(result.auto_answer, true);
    assert.equal(result.session.stage, "ready");
  }
});

test("unclassified free text reaches both search and generation without another question", async () => {
  const initial = await start("如何评价远程办公？");
  const result = await clarify(initial.session_id, owner, {
    context_version: 1,
    selections: {},
    free_text: "我需要照顾家人，希望能灵活安排",
    skip: false,
  });
  assert.equal(result.session.stage, "ready");
  assert.match(result.session.focused_question, /照顾家人/);
  assert.ok(
    buildQueries(result.session).every((query) => query.includes("照顾家人")),
  );
});

test("generic conditions are editable and nullable without domain-specific cleanup", async () => {
  const next = mergeContext(
    {
      topic: "相机",
      scenario: "旅行",
      constraints: "6000 元",
      purpose: "decide",
      priorities: [],
    },
    { purpose: "understand", constraints: null },
  );
  assert.equal(next.constraints, undefined);
  assert.equal(next.scenario, "旅行");
  assert.equal(next.topic, "相机");
});

test("server validation rejects too many choices, state injection, and oversized questions", async () => {
  assert.equal(
    contextSchema.safeParse({ priorities: ["a", "b", "c"] }).success,
    false,
  );
  assert.equal(contextSchema.safeParse({ purpose: "invented" }).success, false);
  assert.equal(
    clarifySchema.safeParse({ context_version: 1, clarification_count: 0 })
      .success,
    false,
  );
  assert.equal(createSchema.safeParse({ question: " " }).success, false);
  assert.equal(
    createSchema.safeParse({ question: "a".repeat(2001) }).success,
    false,
  );
  assert.equal(
    answerSchema.safeParse({ context_version: 1, request_id: "bad" }).success,
    false,
  );
});

test("anonymous credentials are required in addition to the session ID", async () => {
  const session = await start();
  assert.throws(
    () => getSession(session.session_id, "another-browser"),
    (e: unknown) => e instanceof AppError && e.status === 404,
  );
  assert.equal(
    getSession(session.session_id, owner).session_id,
    session.session_id,
  );
});

test("A10: URL deduplication preserves original attribution and rejects unsafe links", async () => {
  const results = deduplicate([
    source,
    {
      ...source,
      content_id: "same-url",
      url: source.url.replace("test", "other"),
    },
    { ...source, content_id: "bad", url: "javascript:alert(1)" },
  ]);
  assert.equal(results.length, 1);
  assert.equal(results[0].url, source.url);
  assert.equal(results[0].id, 1);
});

test("A10/A12: malformed or unknown model citations are not accepted", async () => {
  assert.equal(parseDraft("not valid JSON", [source]), undefined);
  assert.equal(
    parseDraft(JSON.stringify({ ...draft, summary_citations: [999] }), [
      source,
    ]),
    undefined,
  );
  assert.deepEqual(parseDraft(JSON.stringify(draft), [source]), draft);
});

test("A13: same or different request IDs cannot start duplicate generation", async () => {
  const session = await start();
  const id = randomUUID();
  assert.equal(claimAnswer(session.session_id, owner, 1, id).start, true);
  assert.equal(claimAnswer(session.session_id, owner, 1, id).start, false);
  assert.equal(
    claimAnswer(session.session_id, owner, 1, randomUUID()).start,
    false,
  );
  let calls = 0;
  await runAnswer(session.session_id, 1, id, {
    ...provider,
    generate: async () => {
      calls++;
      return draft;
    },
  });
  assert.equal(calls, 1);
  assert.equal(
    claimAnswer(session.session_id, owner, 1, randomUUID()).start,
    false,
  );
  const restored = getSession(session.session_id, owner);
  assert.equal(restored.stage, "completed");
  assert.equal(restored.answers.length, 1);
  addFeedback(session.session_id, owner, {
    answer_id: restored.answers[0].id,
    type: "helpful",
  });
  assert.equal(
    (
      db()
        .prepare("SELECT type FROM feedback WHERE session_id = ?")
        .get(session.session_id) as { type: string }
    ).type,
    "helpful",
  );
});

test("A14: a late answer cannot overwrite changed conditions", async () => {
  const session = await start();
  const request = randomUUID();
  claimAnswer(session.session_id, owner, 1, request);
  let release!: (draft: Draft) => void;
  let reached!: () => void;
  const waiting = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const old = runAnswer(session.session_id, 1, request, {
    ...provider,
    generate: async () => {
      reached();
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  });
  await waiting;
  updateContext(session.session_id, owner, {
    context_version: 1,
    changes: { purpose: "solve" },
  });
  release(draft);
  await old;
  const current = getSession(session.session_id, owner);
  assert.equal(current.context_version, 2);
  assert.equal(current.stage, "ready");
  assert.equal(current.answers.length, 0);
  assert.throws(
    () => claimAnswer(session.session_id, owner, 1, randomUUID()),
    (e: unknown) => e instanceof AppError && e.code === "CONTEXT_CHANGED",
  );
});

test("old completed answers remain available after a context edit", async () => {
  const session = await start();
  const request = randomUUID();
  claimAnswer(session.session_id, owner, 1, request);
  await runAnswer(session.session_id, 1, request, provider);
  const updated = updateContext(session.session_id, owner, {
    context_version: 1,
    changes: { purpose: "decide", priorities: ["长期影响"] },
  }).session;
  assert.equal(updated.answers.length, 1);
  assert.equal(updated.answers[0].context_version, 1);
  assert.equal(updated.clarification_count, session.clarification_count);
});

test("A11: empty results allow only one simplified search, then honest guidance", async () => {
  const session = await start();
  const request = randomUUID();
  let searches = 0;
  let generations = 0;
  claimAnswer(session.session_id, owner, 1, request);
  await runAnswer(session.session_id, 1, request, {
    search: async () => {
      searches++;
      return [];
    },
    generate: async () => {
      generations++;
      return draft;
    },
  });
  const result = getSession(session.session_id, owner);
  assert.equal(searches, 2);
  assert.equal(generations, 0);
  assert.equal(result.answers[0].evidence, "insufficient");
  assert.equal(result.answers[0].sources.length, 0);
});

test("rate limit and invalid credentials stop calls without turning into empty results", async () => {
  for (const code of ["RATE_LIMITED", "AUTH_INVALID", "TIMEOUT"]) {
    const session = await start();
    const request = randomUUID();
    let calls = 0;
    claimAnswer(session.session_id, owner, 1, request);
    await runAnswer(session.session_id, 1, request, {
      search: async () => {
        calls++;
        throw new AppError(code, "受控异常", 503);
      },
      generate: async () => {
        throw new Error("must not generate");
      },
    });
    const result = getSession(session.session_id, owner);
    assert.equal(result.stage, "error");
    assert.equal(result.error?.code, code);
    assert.equal(result.answers.length, 0);
    assert.equal(calls, 1);
    assert.equal(
      claimAnswer(session.session_id, owner, 1, request).start,
      false,
    );
  }
});

test("provider sends documented headers and preserves only valid returned dates", async () => {
  const previousFetch = globalThis.fetch;
  process.env.ZHIHU_ACCESS_SECRET = "test-only-placeholder";
  try {
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.searchParams.get("Count"), "5");
      assert.equal(
        (init?.headers as Record<string, string>)["Authorization"],
        "Bearer test-only-placeholder",
      );
      assert.match(
        (init?.headers as Record<string, string>)["X-Request-Timestamp"],
        /^\d{10}$/,
      );
      return Response.json({
        Code: 0,
        Data: {
          Items: [
            {
              Title: "<em>标题</em>",
              ContentType: "Answer",
              ContentID: "123",
              ContentText: "<em>摘要</em>",
              Url: source.url,
              AuthorName: "作者",
              EditTime: 0,
            },
          ],
        },
      });
    };
    const result = await new ZhihuProvider().search("中山大学");
    assert.equal(result[0].updated_at, undefined);
    assert.equal(result[0].excerpt, "摘要");
  } finally {
    globalThis.fetch = previousFetch;
    delete process.env.ZHIHU_ACCESS_SECRET;
  }
});

test("expired sessions and their feedback/request records are removed", async () => {
  const session = await start();
  db()
    .prepare("UPDATE sessions SET expires = 0 WHERE id = ?")
    .run(session.session_id);
  cleanup();
  assert.throws(() => getSession(session.session_id, owner));
});

test("provider recognizes business errors even when Data is null", async () => {
  const previousFetch = globalThis.fetch;
  process.env.ZHIHU_ACCESS_SECRET = "test-only-placeholder";
  try {
    for (const [Code, expected] of [
      [30001, "RATE_LIMITED"],
      [20001, "AUTH_INVALID"],
    ] as const) {
      globalThis.fetch = async () => Response.json({ Code, Data: null });
      await assert.rejects(
        () => new ZhihuProvider().search("测试"),
        (error: unknown) =>
          error instanceof AppError && error.code === expected,
      );
    }
  } finally {
    globalThis.fetch = previousFetch;
    delete process.env.ZHIHU_ACCESS_SECRET;
  }
});

test("price questions keep the two-query plan and at most one empty-result retry", async () => {
  const session = await start("预算有限，想了解相机的价格和长期使用体验");
  const request = randomUUID();
  const calls: string[] = [];
  claimAnswer(session.session_id, owner, 1, request);
  await runAnswer(session.session_id, 1, request, {
    search: async (query) => {
      calls.push(query);
      return [];
    },
    generate: async () => {
      throw new Error("no evidence");
    },
  });
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.slice(0, 2), buildQueries(session));
  assert.equal(calls[2], session.original_question);
  assert.equal(
    getSession(session.session_id, owner).answers[0].evidence,
    "insufficient",
  );
});

test("the provider only searches Zhihu and filters non-post results while preserving original URLs", async () => {
  const previousFetch = globalThis.fetch;
  process.env.ZHIHU_ACCESS_SECRET = "test-only-placeholder";
  try {
    globalThis.fetch = async (input) => {
      assert.equal(
        new URL(String(input)).pathname,
        "/api/v1/content/zhihu_search",
      );
      return Response.json({
        Code: 0,
        Data: {
          Items: [
            ["Article", "https://zhuanlan.zhihu.com/p/123?utm_source=test"],
            ["answer", source.url],
            ["Question", "https://www.zhihu.com/question/456"],
            ["Article", "https://example.com/official"],
            [
              "Article",
              "https://link.zhihu.com/?target=https%3A%2F%2Fexample.com",
            ],
            ["Answer", "https://www.zhihu.com/people/example"],
            ["Profile", source.url],
          ].map(([ContentType, Url], index) => ({
            Title: "测试帖子",
            ContentType,
            ContentID: String(index),
            ContentText: "测试摘要",
            Url,
            AuthorName: "测试作者",
          })),
        },
      });
    };
    const result = await new ZhihuProvider().search("政策");
    assert.equal(result.length, 3);
    assert.ok(result.every((item) => item.channel === "zhihu"));
    assert.equal(
      result[0].url,
      "https://zhuanlan.zhihu.com/p/123?utm_source=test",
    );
    assert.equal(result[1].url, source.url);
  } finally {
    globalThis.fetch = previousFetch;
    delete process.env.ZHIHU_ACCESS_SECRET;
  }
});

test("post URLs reject redirects, look-alike domains, credentials, and non-post pages", async () => {
  for (const url of [
    "https://zhihu.com/question/12/",
    source.url,
    "https://www.zhihu.com/answer/123",
    "https://zhuanlan.zhihu.com/p/123?utm_source=original#section",
  ])
    assert.equal(isZhihuPostUrl(url), true, url);
  for (const url of [
    "javascript:alert(1)",
    "https://zhihu.com.evil.test/question/1",
    "https://www.zhihu.com@evil.test/question/1",
    "https://evil@www.zhihu.com/question/1",
    "https://link.zhihu.com/?target=https://www.zhihu.com/question/1",
    "https://www.zhihu.com/people/example",
    "https://www.zhihu.com/search?q=example",
    "https://developer.zhihu.com/question/1",
    "https://www.zhihu.com/question/1/redirect",
    "https://www.zhihu.com:8080/question/1",
  ])
    assert.equal(isZhihuPostUrl(url), false, url);
});

test("runtime filters injected external sources before generation and text output lists posts first", async () => {
  const { presentAgentReply } = await import("../src/lib/agent/bridge");
  const session = await start();
  const request = randomUUID();
  claimAnswer(session.session_id, owner, 1, request);
  await runAnswer(session.session_id, 1, request, {
    search: async () => [
      { ...source, content_id: "external", url: "https://example.com/post" },
      source,
      { ...source, content_id: "old-global", channel: "global" },
    ],
    generate: async (_, sources) => {
      assert.deepEqual(sources, [source]);
      return draft;
    },
  });
  const result = getSession(session.session_id, owner);
  assert.deepEqual(result.answers[0].sources, [source]);
  const reply = presentAgentReply(result);
  assert.match(reply.text, /测试摘要/);
  assert.ok(reply.text.indexOf(source.url) < reply.text.indexOf("AI 辅助总结"));
  result.answers[0].sources.push({
    ...source,
    id: 2,
    channel: "global",
    url: "https://example.com/post",
  });
  const legacy = presentAgentReply(result);
  assert.doesNotMatch(legacy.text, /example\.com|测试结论/);
  assert.match(legacy.text, /旧总结已隐藏/);
});

test("text-only agent conversation supports clarification, answer, revision, and identity isolation", async () => {
  const { receiveAgentMessage } = await import("../src/lib/agent/bridge");
  let reply = await receiveAgentMessage(
    { message: "如何评价远程办公？", request_id: randomUUID() },
    owner,
    provider,
  );
  assert.equal(reply.stage, "clarifying");
  assert.match(reply.text, /比较与选择/);
  reply = await receiveAgentMessage(
    {
      message: "2",
      session_id: reply.session_id,
      context_version: reply.context_version,
      request_id: randomUUID(),
    },
    owner,
    provider,
  );
  assert.equal(reply.stage, "clarifying");
  reply = await receiveAgentMessage(
    {
      message: "我需要照顾家人",
      session_id: reply.session_id,
      context_version: reply.context_version,
      request_id: randomUUID(),
    },
    owner,
    provider,
  );
  assert.equal(reply.stage, "completed");
  assert.match(reply.text, /测试结论/);
  assert.match(reply.text, /https:\/\/www.zhihu.com/);
  assert.match(reply.answer!.queries[0], /照顾家人/);
  const oldVersion = reply.context_version;
  await assert.rejects(
    () =>
      receiveAgentMessage(
        {
          message: "继续",
          session_id: reply.session_id,
          context_version: reply.context_version,
          request_id: randomUUID(),
        },
        "another-owner",
        provider,
      ),
    (e: unknown) => e instanceof AppError && e.status === 404,
  );
  reply = await receiveAgentMessage(
    {
      message: "更关注长期影响",
      session_id: reply.session_id,
      context_version: reply.context_version,
      request_id: randomUUID(),
    },
    owner,
    provider,
  );
  assert.equal(reply.stage, "completed");
  assert.ok(reply.context_version > oldVersion);
  assert.equal(getSession(reply.session_id, owner).answers.length, 2);
});

test("text-only agent honors skipping without imposing required form fields", async () => {
  const { receiveAgentMessage } = await import("../src/lib/agent/bridge");
  const initial = await receiveAgentMessage(
    { message: "如何评价远程办公？", request_id: randomUUID() },
    owner,
    provider,
  );
  const reply = await receiveAgentMessage(
    {
      message: "直接回答",
      session_id: initial.session_id,
      context_version: initial.context_version,
      request_id: randomUUID(),
    },
    owner,
    provider,
  );
  assert.equal(reply.stage, "completed");
});

test("long questions preserve the latest supplement within the search budget", async () => {
  const session = await start("如何评价远程办公？" + "背景".repeat(900));
  const updated = updateContext(session.session_id, owner, {
    context_version: 1,
    changes: { constraints: "周末无法工作" },
    free_text: "最新条件：需要照顾家人",
  }).session;
  const queries = buildQueries(updated);
  assert.ok(
    queries.every(
      (query) =>
        query.length <= 2000 &&
        query.includes("最新条件") &&
        query.includes("周末无法工作"),
    ),
  );
});

test("legacy session data is preserved but rejected instead of misinterpreted", async () => {
  const session = await start();
  const old = { ...session, schema_version: undefined };
  db()
    .prepare("UPDATE sessions SET data = ? WHERE id = ?")
    .run(JSON.stringify(old), session.session_id);
  assert.throws(
    () => getSession(session.session_id, owner),
    (e: unknown) =>
      e instanceof AppError && e.code === "SESSION_VERSION" && e.status === 410,
  );
  assert.ok(
    db()
      .prepare("SELECT id FROM sessions WHERE id = ?")
      .get(session.session_id),
  );
});

test("documented Zhida text response is shown without assigning retrieved citations", async () => {
  const { parseTextDraft } = await import("../src/lib/server/providers");
  const text = parseTextDraft(
    "# 远程办公\n\n**体验差异**\n不同人的实际体验可能不同。",
  );
  assert.equal(text?.format, "zhida_text");
  assert.equal(text?.summary_citations.length, 0);
  assert.ok(text?.sections.every((section) => section.citations.length === 0));
  assert.match(text!.limitations.join(""), /不能视为正文每项结论的证据/);
  const session = await start();
  const request = randomUUID();
  claimAnswer(session.session_id, owner, 1, request);
  await runAnswer(session.session_id, 1, request, {
    ...provider,
    generate: async () => text!,
  });
  assert.equal(
    getSession(session.session_id, owner).answers[0].evidence,
    "unverified",
  );
});

test("invalid JSON citations cannot bypass validation through text mode", async () => {
  const { parseTextDraft } = await import("../src/lib/server/providers");
  assert.equal(
    parseTextDraft(JSON.stringify({ ...draft, summary_citations: [999] })),
    undefined,
  );
  assert.equal(
    parseTextDraft('```json\n{"summary": "invalid"}\n```'),
    undefined,
  );
});

test("sources mode never calls the exhausted generation endpoint", async () => {
  const oldMode = process.env.ZHIHU_GENERATION_MODE;
  const oldFetch = globalThis.fetch;
  try {
    process.env.ZHIHU_GENERATION_MODE = "sources";
    globalThis.fetch = async () => {
      throw new Error("No upstream call allowed");
    };
    const result = await new ZhihuProvider().generate(await start(), [source]);
    assert.equal(result.format, "source_excerpts");
    assert.deepEqual(result.sections[0].citations, [source.id]);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldMode === undefined) delete process.env.ZHIHU_GENERATION_MODE;
    else process.env.ZHIHU_GENERATION_MODE = oldMode;
  }
});

test("generation quota errors retain actual sources and never retry generation", async () => {
  const session = await start();
  const request = randomUUID();
  let calls = 0;
  claimAnswer(session.session_id, owner, 1, request);
  await runAnswer(session.session_id, 1, request, {
    ...provider,
    generate: async () => {
      calls++;
      throw new AppError("RATE_LIMITED", "受控额度耗尽", 429);
    },
  });
  const result = getSession(session.session_id, owner);
  assert.equal(calls, 1);
  assert.equal(result.stage, "completed");
  assert.equal(result.answers[0].format, "source_excerpts");
  assert.match(result.answers[0].limitations.join(""), /额度或频率受限/);
});

test("deleting history enforces ownership and removes related data only for that session", async () => {
  const session = await start();
  const other = await start();
  db().prepare("INSERT INTO requests VALUES (?, ?, ?, ?)").run(session.session_id, "delete-test", 1, "completed");
  db().prepare("INSERT INTO feedback VALUES (?, ?, ?, ?)").run(session.session_id, "answer-test", "helpful", null);
  assert.throws(() => deleteSession(session.session_id, "another-owner"), AppError);
  assert.equal(getSession(session.session_id, owner).session_id, session.session_id);
  deleteSession(session.session_id, owner);
  assert.throws(() => getSession(session.session_id, owner), AppError);
  assert.equal(db().prepare("SELECT * FROM requests WHERE session_id = ?").get(session.session_id), undefined);
  assert.equal(db().prepare("SELECT * FROM feedback WHERE session_id = ?").get(session.session_id), undefined);
  assert.equal(getSession(other.session_id, owner).session_id, other.session_id);
  assert.throws(() => deleteSession(session.session_id, owner), AppError);
});
