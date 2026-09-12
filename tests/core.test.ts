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
import { getSession, db, cleanup } from "../src/lib/server/store";
import {
  deduplicate,
  parseDraft,
  ZhihuProvider,
  type Draft,
  type KnowledgeProvider,
} from "../src/lib/server/providers";
import type { Source } from "../src/lib/domain/types";

process.env.WENSHAN_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "wenshan-test-")),
  "sessions.sqlite",
);
process.env.WENSHAN_PROVIDER = "live";
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
const start = (question = "中大计算机本科课程体验怎么样？") =>
  createSession(question, owner).session;

test("A01: broad university question asks purpose only", () => {
  const session = start("如何评价中山大学？");
  assert.equal(session.stage, "clarifying");
  assert.deepEqual(session.clarification?.fields, ["purpose"]);
  assert.equal(session.confirmed_context.school, "中山大学");
  assert.equal(session.confirmed_context.province, undefined);
});

test("A02/A04: explicit questions skip clarification and retain supplied facts", () => {
  for (const question of [
    "中大计算机本科课程体验怎么样？",
    "我是广东高三学生，想了解中大计算机就业",
    "中山大学在哪里？",
    "先整体介绍一下中山大学，不要追问",
    "北京今天是什么天气？",
  ]) {
    const result = createSession(question, owner);
    assert.equal(result.auto_answer, true, question);
    assert.equal(result.session.stage, "ready", question);
  }
  const c = extractContext("我是广东高三学生，想了解中大计算机就业");
  assert.equal(c.province, "广东");
  assert.equal(c.purpose, "undergraduate");
  assert.equal(c.major, "计算机");
});

test("A03/A08: two rounds produce focused queries and stop", () => {
  const initial = start("如何评价中山大学？");
  const first = clarify(initial.session_id, owner, {
    context_version: 1,
    selections: { purpose: "undergraduate" },
    skip: false,
  }).session;
  assert.deepEqual(first.clarification?.fields, ["major", "priorities"]);
  const final = clarify(initial.session_id, owner, {
    context_version: first.context_version,
    selections: { major: "计算机", priorities: ["就业发展", "学习体验"] },
    skip: false,
  }).session;
  assert.equal(final.clarification_count, 2);
  assert.equal(final.stage, "ready");
  assert.deepEqual(buildQueries(final), [
    "中山大学 计算机 本科报考 就业发展",
    "中山大学 计算机 本科报考 学习体验",
  ]);
  assert.equal(final.clarification, undefined);
});

test("A05/A06: skip or overview immediately authorizes an answer", () => {
  for (const selections of [{}, { purpose: "overview" as const }]) {
    const session = start("如何评价中山大学？");
    const result = clarify(session.session_id, owner, {
      context_version: 1,
      selections,
      skip: !Object.keys(selections).length,
    });
    assert.equal(result.auto_answer, true);
    assert.equal(result.session.stage, "ready");
    assert.equal(result.session.clarification, undefined);
  }
});

test("A07: unparsed free text is preserved and never re-asked as the same card", () => {
  const initial = start("如何评价中山大学？");
  const result = clarify(initial.session_id, owner, {
    context_version: 1,
    selections: {},
    free_text: "希望参加天文社团，喜欢安静的环境",
    skip: false,
  });
  assert.equal(result.session.stage, "ready");
  assert.match(result.session.focused_question, /天文社团/);
  assert.deepEqual(result.session.free_text_context, [
    "希望参加天文社团，喜欢安静的环境",
  ]);
});

test("A09: changing purpose clears undergraduate-only conditions", () => {
  const next = mergeContext(
    {
      school: "中山大学",
      major: "计算机",
      purpose: "undergraduate",
      province: "广东",
      year: "2026",
      priorities: ["就业发展"],
    },
    { purpose: "postgraduate" },
  );
  assert.equal(next.province, undefined);
  assert.equal(next.year, undefined);
  assert.equal(next.major, "计算机");
  assert.equal(next.school, "中山大学");
});

test("server validation rejects too many choices, state injection, and oversized questions", () => {
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

test("anonymous credentials are required in addition to the session ID", () => {
  const session = start();
  assert.throws(
    () => getSession(session.session_id, "another-browser"),
    (e: unknown) => e instanceof AppError && e.status === 404,
  );
  assert.equal(
    getSession(session.session_id, owner).session_id,
    session.session_id,
  );
});

test("A10: URL deduplication preserves original attribution and rejects unsafe links", () => {
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

test("A10/A12: malformed or unknown model citations are not accepted", () => {
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
  const session = start();
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
  const session = start();
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
    changes: { purpose: "postgraduate" },
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
  const session = start();
  const request = randomUUID();
  claimAnswer(session.session_id, owner, 1, request);
  await runAnswer(session.session_id, 1, request, provider);
  const updated = updateContext(session.session_id, owner, {
    context_version: 1,
    changes: { purpose: "campus", priorities: ["住宿条件"] },
  }).session;
  assert.equal(updated.answers.length, 1);
  assert.equal(updated.answers[0].context_version, 1);
  assert.equal(updated.clarification_count, session.clarification_count);
});

test("A11: empty results allow only one simplified search, then honest guidance", async () => {
  const session = start();
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
    const session = start();
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

test("expired sessions and their feedback/request records are removed", () => {
  const session = start();
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
