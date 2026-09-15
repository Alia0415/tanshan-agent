import { identity } from "@/lib/server/http";
import { consumeOAuthState, exchangeToken, fetchUserProfile, saveOAuthSession } from "@/lib/server/oauth";

export const runtime = "nodejs";

// A relative Location keeps the browser on the host it actually used;
// request.url may be rebuilt as localhost in dev, and 127.0.0.1 / localhost
// carry separate visitor cookies.
const home = (query: string) =>
  new Response(null, { status: 307, headers: { Location: "/me?oauth=" + query, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });

export async function GET(request: Request) {
  const url = new URL(request.url);
  // 黑客松主回调参数为 authorization_code，兼容读取 code。
  const code =
    url.searchParams.get("authorization_code") || url.searchParams.get("code");
  const state = url.searchParams.get("state") || "";
  if (!code) return home("missing-code");
  try {
    const visitor = await identity();
    if (!consumeOAuthState(visitor, state)) return home("state-mismatch");
    const token = await exchangeToken(code);
    const profile = await fetchUserProfile(token.accessToken);
    saveOAuthSession(visitor, token.accessToken, token.expiresIn, profile);
    return home("ok");
  } catch {
    // 换取失败不给用户暴露细节，回到登录页重试。
    return home("token-failed");
  }
}
