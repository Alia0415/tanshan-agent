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
