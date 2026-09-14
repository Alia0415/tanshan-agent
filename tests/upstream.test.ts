import test from "node:test";
import assert from "node:assert/strict";
import { assertUpstreamUrl } from "../src/lib/server/upstream";

test("known upstreams over https pass through unchanged", () => {
  for (const url of [
    "https://developer.zhihu.com/api/v1/content/zhihu_search?Query=a&Count=5",
    "https://openapi.zhihu.com/access_token",
    "https://api.deepseek.com/chat/completions",
  ])
    assert.equal(assertUpstreamUrl(url), url);
});

test("plain http, credentials, unknown and internal hosts are refused before any request", () => {
  for (const url of [
    "http://developer.zhihu.com/api/v1/content/hot_list",
    "https://user:pw@developer.zhihu.com/",
    "https://developer.zhihu.com@evil.example/",
    "https://evil.example/",
    "https://localhost/",
    "https://127.0.0.1/",
    "https://10.0.0.8/",
    "https://192.168.1.1/",
    "https://172.20.0.1/",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/",
    "https://service.internal/",
    "not a url",
  ])
    assert.throws(() => assertUpstreamUrl(url), { code: "UPSTREAM_URL" }, url);
});
