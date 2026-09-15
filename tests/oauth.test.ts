import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.WENSHAN_DB_PATH = join(mkdtempSync(join(tmpdir(), "wenshan-oauth-")), "test.sqlite");
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildAuthorizeUrl,
  parseTokenResponse,
} from "../src/lib/server/oauth";

test("authorize url carries registered params", () => {
  const url = new URL(
    buildAuthorizeUrl(
      { appId: "123456", redirectUri: "https://example.com/api/oauth/callback" },
      "visitor-state",
    ),
  );
  assert.equal(url.origin + url.pathname, "https://openapi.zhihu.com/authorize");
  assert.equal(url.searchParams.get("app_id"), "123456");
  assert.equal(
    url.searchParams.get("redirect_uri"),
    "https://example.com/api/oauth/callback",
  );
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("state"), "visitor-state");
});

test("token parsing trusts access_token over business codes", () => {
  assert.deepEqual(
    parseTokenResponse({ access_token: "t", expires_in: 7200 }),
    { accessToken: "t", expiresIn: 7200 },
  );
  // code:20000 但没有 token：视为失败
  assert.equal(parseTokenResponse({ code: 20000 }), null);
  // 有 token 的业务成功标记：成功，并给缺失时长兜底
  assert.deepEqual(parseTokenResponse({ access_token: "t", code: 20000 }), {
    accessToken: "t",
    expiresIn: 3600,
  });
  assert.equal(parseTokenResponse(null), null);
  assert.equal(parseTokenResponse({ access_token: "" }), null);
});

import { createOAuthState, consumeOAuthState, parseUserProfile, saveOAuthSession, getOAuthSession, clearOAuthSession, fetchUserApi, exchangeToken, fetchUserProfile } from "../src/lib/server/oauth";
import { db } from "../src/lib/server/store";
import { contentQuerySchema, pageSchema } from "../src/lib/server/user-api-routes";
import { AppError } from "../src/lib/domain/validation";

test("state is short lived, browser bound and consumed only once", () => {
  const first = createOAuthState("alice");
  assert.notEqual(first, "alice");
  assert.equal(consumeOAuthState("alice", ""), false);
  assert.equal(consumeOAuthState("alice", "wrong"), false);
  assert.equal(consumeOAuthState("bob", first), false);
  assert.equal(consumeOAuthState("alice", first), true);
  assert.equal(consumeOAuthState("alice", first), false);
  const expired = createOAuthState("alice");
  db().prepare("UPDATE oauth_states SET expires_at = 0 WHERE state = ?").run(expired);
  assert.equal(consumeOAuthState("alice", expired), false);
  const previous = createOAuthState("alice");
  const current = createOAuthState("alice");
  assert.equal(consumeOAuthState("alice", previous), false);
  assert.equal(consumeOAuthState("alice", current), true);
});
test("profiles preserve large IDs and exclude private contact fields", () => {
  const profile = parseUserProfile('{"uid":969570047710216201,"fullname":"测试用户","avatar_path":"javascript:alert(1)","email":"private@example.com"}');
  assert.equal(profile?.id, "969570047710216201");
  assert.equal(profile?.avatar, "");
  assert.ok(!JSON.stringify(profile).includes("email"));
  assert.equal(parseUserProfile('{"code":404,"data":"User does not exist"}'), null);
  assert.equal(parseUserProfile('{"code":404,"data":{"uid":"123"}}'), null);
  assert.equal(parseUserProfile('{"code":20000,"data":{"hash_id":"user-id","fullname":"名字"}}')?.name, "名字");
});
test("sessions isolate users, expire and clear on logout", () => {
  const user = { id: "alice-id", name: "Alice", headline: "", description: "", avatar: "" };
  saveOAuthSession("alice", "mock-token", 3600, user);
  assert.equal(getOAuthSession("alice")?.user.id, user.id);
  assert.equal(getOAuthSession("bob"), null);
  clearOAuthSession("alice");
  assert.equal(getOAuthSession("alice"), null);
  saveOAuthSession("alice", "mock-token", -1, user);
  assert.equal(getOAuthSession("alice"), null);
});
test("content query keeps required type and lossless cursor beyond 1000", () => {
  assert.deepEqual(contentQuerySchema.parse({ Offset: "969570047710216201", Limit: "20" }), {
    Offset: "969570047710216201", Limit: 20, ContentType: "all", SortField: "ts", SortOrder: "desc",
  });
  for (const Offset of ["-1", "1.5", "x", "9223372036854775808"]) assert.equal(pageSchema.safeParse({ Offset }).success, false);
  assert.equal(contentQuerySchema.safeParse({ ContentType: "invalid" }).success, false);
});
test("OAuth uses correct endpoints and rejects HTTP and business failures", async (t) => {
  const original = globalThis.fetch;
  const env = process.env.ZHIHU_ACCESS_SECRET;
  process.env.ZHIHU_ACCESS_SECRET = "mock-secret";
  t.after(() => { globalThis.fetch = original; if (env === undefined) delete process.env.ZHIHU_ACCESS_SECRET; else process.env.ZHIHU_ACCESS_SECRET = env; });
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    if (url.endsWith("/user")) {
      assert.ok(headers.get("Authorization") === "Bearer mock-oauth");
      return Response.json({ uid: "123", fullname: "测试账号" });
    }
    assert.ok(url.startsWith("https://developer.zhihu.com/api/v1/user/"));
    assert.ok(headers.get("Authorization") === "Bearer mock-secret");
    assert.ok(headers.get("X-OAuth-Token") === "mock-oauth");
    assert.ok(headers.has("X-Request-Timestamp"));
    return Response.json({ Code: 0, Data: { Items: [], Paging: { IsEnd: true } } });
  };
  assert.equal((await fetchUserProfile("mock-oauth")).id, "123");
  await fetchUserApi("/api/v1/user/contents?ContentType=all", "mock-oauth");
  for (const [Code, status] of [[20001,401], [30002,429], [90001,502]]) {
    globalThis.fetch = async () => Response.json({ Code });
    await assert.rejects(fetchUserApi("/api/v1/user/followees", "mock-oauth"), (error: unknown) => error instanceof AppError && error.status === status);
  }
  globalThis.fetch = async () => Response.json({ access_token: "mock-token" }, { status: 500 });
  await assert.rejects(exchangeToken("mock-code"));
});
