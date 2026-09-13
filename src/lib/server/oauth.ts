import { DatabaseSync } from "node:sqlite";
import { db } from "./store";
import { AppError } from "../domain/validation";

// 知乎黑客松 OAuth：app_id / app_key 由活动页面分配，回调地址必须与登记值完全一致。
// app_key 与 OAuth access_token 只在本模块（服务端）出现，绝不写入日志或响应。

const AUTHORIZE_ENDPOINT = "https://openapi.zhihu.com/authorize";
const TOKEN_ENDPOINT = "https://openapi.zhihu.com/access_token";
const USER_API_BASE = "https://developer.zhihu.com";

export type OAuthConfig = {
  configured: boolean;
  appId: string;
  appKey: string;
  redirectUri: string;
};

export function oauthConfig(): OAuthConfig {
  const appId = process.env.ZHIHU_OAUTH_APP_ID?.trim() || "";
  const appKey = process.env.ZHIHU_OAUTH_APP_KEY?.trim() || "";
  const redirectUri = process.env.ZHIHU_OAUTH_REDIRECT_URI?.trim() || "";
  return {
    configured: Boolean(appId && appKey && redirectUri),
    appId,
    appKey,
    redirectUri,
  };
}

export function buildAuthorizeUrl(
  config: Pick<OAuthConfig, "appId" | "redirectUri">,
  state: string,
) {
  const url = new URL(AUTHORIZE_ENDPOINT);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("app_id", config.appId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  return url.toString();
}

export function parseTokenResponse(payload: unknown) {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as Record<string, unknown>;
  // 以 access_token 是否存在为准；code:20000 只是业务标记，不能单独判定失败。
  const accessToken =
    typeof record.access_token === "string" ? record.access_token : "";
  if (!accessToken) return null;
  const expiresIn =
    typeof record.expires_in === "number" && record.expires_in > 0
      ? record.expires_in
      : 3600;
  return { accessToken, expiresIn };
}

export async function exchangeToken(code: string) {
  const config = oauthConfig();
  if (!config.configured)
    throw new AppError(
      "OAUTH_NOT_CONFIGURED",
      "知乎登录尚未配置，请在活动页面创建项目并填写 App ID / App Key / 回调地址。",
      503,
    );
  const form = new URLSearchParams({
    app_id: config.appId,
    app_key: config.appKey,
    grant_type: "authorization_code",
    redirect_uri: config.redirectUri,
    code,
  });
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  const token = parseTokenResponse(payload);
  if (!token)
    throw new AppError(
      "OAUTH_TOKEN_FAILED",
      "换取知乎授权失败，请重新发起登录。",
      502,
    );
  return token;
}

type OAuthRow = { visitor: string; access_token: string; expires_at: number };
const state = globalThis as unknown as { wenshanOauthReady?: DatabaseSync };

function ensureTable() {
  if (state.wenshanOauthReady) return;
  db().exec(`
    CREATE TABLE IF NOT EXISTS oauth_sessions (
      visitor TEXT PRIMARY KEY,
      access_token TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);
  state.wenshanOauthReady = db();
}

export function saveOAuthSession(visitor: string, token: string, expiresIn: number) {
  ensureTable();
  db()
    .prepare(
      "INSERT INTO oauth_sessions (visitor, access_token, expires_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(visitor) DO UPDATE SET access_token = excluded.access_token, expires_at = excluded.expires_at",
    )
    .run(visitor, token, Date.now() + expiresIn * 1000);
}

export function getOAuthSession(visitor: string) {
  ensureTable();
  const row = db()
    .prepare("SELECT visitor, access_token, expires_at FROM oauth_sessions WHERE visitor = ?")
    .get(visitor) as OAuthRow | undefined;
  if (!row || row.expires_at <= Date.now()) return null;
  return { accessToken: row.access_token, expiresAt: row.expires_at };
}

export function clearOAuthSession(visitor: string) {
  ensureTable();
  db().prepare("DELETE FROM oauth_sessions WHERE visitor = ?").run(visitor);
}

export function requireOAuthSession(visitor: string) {
  const session = getOAuthSession(visitor);
  if (!session)
    throw new AppError(
      "OAUTH_NOT_LOGGED_IN",
      "请先登录知乎账号再查看这部分内容。",
      401,
    );
  return session;
}

// 用户数据接口三件套：Access Secret 鉴权调用方，X-OAuth-Token 指明授权用户。
export async function fetchUserApi(path: string, accessToken: string) {
  const secret = process.env.ZHIHU_ACCESS_SECRET?.trim();
  if (!secret)
    throw new AppError(
      "OAUTH_NOT_CONFIGURED",
      "服务端尚未配置 Access Secret。",
      503,
    );
  const response = await fetch(USER_API_BASE + path, {
    headers: {
      Authorization: `Bearer ${secret}`,
      "X-OAuth-Token": accessToken,
      "X-Request-Timestamp": String(Math.floor(Date.now() / 1000)),
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok || payload === null) {
    throw new AppError(
      "OAUTH_UPSTREAM",
      response.status === 401 || response.status === 403
        ? "知乎授权已过期，请重新登录。"
        : "知乎接口暂时无法访问，请稍后再试。",
      response.status === 401 || response.status === 403 ? 401 : 502,
    );
  }
  return payload;
}
