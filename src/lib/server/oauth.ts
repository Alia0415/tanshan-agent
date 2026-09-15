import { assertUpstreamUrl } from "./upstream";
import { zhihuDeployment } from "./zhihu-deployment";
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { db } from "./store";
import { AppError } from "../domain/validation";
import { safeWebUrl, type ZhihuUser } from "../domain/zhihu-user";

export type OAuthConfig = { configured: boolean; appId: string; appKey: string; redirectUri: string };
export function oauthConfig(): OAuthConfig {
  const appId = process.env.ZHIHU_OAUTH_APP_ID?.trim() || process.env.ZHIHU_APP_ID?.trim() || zhihuDeployment.appId;
  const appKey = process.env.ZHIHU_OAUTH_APP_KEY?.trim() || process.env.ZHIHU_APP_KEY?.trim() || zhihuDeployment.appKey;
  const redirectUri = process.env.ZHIHU_OAUTH_REDIRECT_URI?.trim() || zhihuDeployment.redirectUri;
  return { configured: Boolean(appId && appKey && redirectUri), appId, appKey, redirectUri };
}
export function buildAuthorizeUrl(config: Pick<OAuthConfig, "appId" | "redirectUri">, state: string) {
  const url = new URL("https://openapi.zhihu.com/authorize");
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("app_id", config.appId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  return url.toString();
}
export function parseTokenResponse(payload: unknown) {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as Record<string, unknown>;
  const accessToken = typeof record.access_token === "string" ? record.access_token.trim() : "";
  if (!accessToken) return null;
  const expiresIn = typeof record.expires_in === "number" && Number.isFinite(record.expires_in) && record.expires_in > 0 ? record.expires_in : 3600;
  return { accessToken, expiresIn };
}
export async function exchangeToken(code: string) {
  const config = oauthConfig();
  if (!config.configured) throw new AppError("OAUTH_NOT_CONFIGURED", "知乎登录暂未开放。", 503);
  const form = new URLSearchParams({ app_id: config.appId, app_key: config.appKey, grant_type: "authorization_code", redirect_uri: config.redirectUri, code });
  const response = await fetch(assertUpstreamUrl("https://openapi.zhihu.com/access_token"), {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString(),
    signal: AbortSignal.timeout(15_000), cache: "no-store",
  });
  const token = parseTokenResponse(await response.json().catch(() => null));
  if (!response.ok || !token) throw new AppError("OAUTH_TOKEN_FAILED", "换取知乎授权失败，请重新登录。", 502);
  return token;
}
export function parseUserProfile(text: string): ZhihuUser | null {
  // Quote integer IDs before JSON.parse can round them.
  const payload = JSON.parse(text.replace(/("uid"\s*:\s*)(\d+)(?=\s*[,}])/g, '$1"$2"'));
  if (payload?.code !== undefined && payload.code !== 0 && payload.code !== 20000) return null;
  const user = payload?.data && typeof payload.data === "object" ? payload.data : payload;
  if (!user || typeof user !== "object") return null;
  const id = typeof user.hash_id === "string" && user.hash_id ? user.hash_id
    : typeof user.uid === "string" && /^[1-9]\d*$/.test(user.uid) ? user.uid : "";
  if (!id) return null;
  return { id, name: typeof user.fullname === "string" && user.fullname ? user.fullname : "知乎用户",
    avatar: safeWebUrl(user.avatar_path), headline: typeof user.headline === "string" ? user.headline : "",
    description: typeof user.description === "string" ? user.description : "" };
}
export async function fetchUserProfile(accessToken: string) {
  const response = await fetch(assertUpstreamUrl("https://openapi.zhihu.com/user"), {
    headers: { Authorization: "Bearer " + accessToken }, cache: "no-store", signal: AbortSignal.timeout(15_000),
  });
  const user = response.ok ? parseUserProfile(await response.text()) : null;
  if (!user) throw new AppError("OAUTH_PROFILE_FAILED", "无法读取知乎用户资料，请重新登录。", 401);
  return user;
}
type OAuthRow = { access_token: string; expires_at: number; profile: string | null };
const state = globalThis as unknown as { tanshanOauthReady?: DatabaseSync };
function ensureTable() {
  if (state.tanshanOauthReady === db()) return;
  db().exec("CREATE TABLE IF NOT EXISTS oauth_sessions (visitor TEXT PRIMARY KEY, access_token TEXT NOT NULL, expires_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS oauth_states (state TEXT PRIMARY KEY, visitor TEXT NOT NULL, expires_at INTEGER NOT NULL);");
  const columns = db().prepare("PRAGMA table_info(oauth_sessions)").all() as { name: string }[];
  if (!columns.some((column) => column.name === "profile")) db().exec("ALTER TABLE oauth_sessions ADD COLUMN profile TEXT");
  state.tanshanOauthReady = db();
}
export function createOAuthState(visitor: string) {
  ensureTable();
  db().prepare("DELETE FROM oauth_states WHERE expires_at <= ? OR visitor = ?").run(Date.now(), visitor);
  const nonce = randomBytes(32).toString("hex");
  db().prepare("INSERT INTO oauth_states VALUES (?, ?, ?)").run(nonce, visitor, Date.now() + 600_000);
  return nonce;
}
export function consumeOAuthState(visitor: string, nonce: string) {
  ensureTable();
  if (!nonce) return false;
  return Boolean(db().prepare("DELETE FROM oauth_states WHERE state = ? AND visitor = ? AND expires_at > ? RETURNING state").get(nonce, visitor, Date.now()));
}
export function saveOAuthSession(visitor: string, token: string, expiresIn: number, profile?: ZhihuUser) {
  ensureTable();
  db().prepare("INSERT INTO oauth_sessions (visitor, access_token, expires_at, profile) VALUES (?, ?, ?, ?) ON CONFLICT(visitor) DO UPDATE SET access_token = excluded.access_token, expires_at = excluded.expires_at, profile = excluded.profile")
    .run(visitor, token, Date.now() + Math.min(expiresIn, 86400) * 1000, profile ? JSON.stringify(profile) : null);
}
export function getOAuthSession(visitor: string) {
  ensureTable();
  db().prepare("DELETE FROM oauth_sessions WHERE expires_at <= ?").run(Date.now());
  const row = db().prepare("SELECT access_token, expires_at, profile FROM oauth_sessions WHERE visitor = ?").get(visitor) as OAuthRow | undefined;
  if (!row || !row.profile) return null;
  return { accessToken: row.access_token, expiresAt: row.expires_at, user: JSON.parse(row.profile) as ZhihuUser };
}
export function clearOAuthSession(visitor: string) {
  ensureTable();
  db().prepare("DELETE FROM oauth_sessions WHERE visitor = ?").run(visitor);
  db().prepare("DELETE FROM oauth_states WHERE visitor = ?").run(visitor);
}
export function requireOAuthSession(visitor: string) {
  const session = getOAuthSession(visitor);
  if (!session) throw new AppError("OAUTH_NOT_LOGGED_IN", "请先登录知乎账号。", 401);
  return session;
}
export async function fetchUserApi(path: string, accessToken: string) {
  if (!accessToken) throw new AppError("OAUTH_NOT_LOGGED_IN", "请先登录知乎账号。", 401);
  const secret = process.env.ZHIHU_ACCESS_SECRET?.trim() || zhihuDeployment.accessSecret;
  if (!secret) throw new AppError("OAUTH_NOT_CONFIGURED", "用户内容服务暂未开放。", 503);
  const response = await fetch(assertUpstreamUrl("https://developer.zhihu.com" + path), {
    headers: { Authorization: "Bearer " + secret, "X-OAuth-Token": accessToken,
      "X-Request-Timestamp": String(Math.floor(Date.now() / 1000)), "Content-Type": "application/json" },
    signal: AbortSignal.timeout(20_000), cache: "no-store",
  });
  const payload = await response.json().catch(() => null) as { Code?: number } | null;
  const unauthorized = response.status === 401 || response.status === 403 || payload?.Code === 20001;
  const limited = response.status === 429 || payload?.Code === 30001 || payload?.Code === 30002;
  if (!response.ok || !payload || payload.Code !== 0)
    throw new AppError("OAUTH_UPSTREAM", unauthorized ? "知乎授权已失效，请重新登录。" : limited ? "知乎接口额度或访问频率受限，请稍后再试。" : "知乎接口暂时无法访问，请稍后再试。", unauthorized ? 401 : limited ? 429 : 502);
  return payload;
}
