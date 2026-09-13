import { NextResponse } from "next/server";
import { identity } from "@/lib/server/http";
import { exchangeToken, saveOAuthSession } from "@/lib/server/oauth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  // 黑客松主回调参数为 authorization_code，兼容读取 code。
  const code =
    url.searchParams.get("authorization_code") || url.searchParams.get("code");
  const state = url.searchParams.get("state") || "";
  const home = (query: string) =>
    NextResponse.redirect(new URL("/me?oauth=" + query, request.url));
  if (!code) return home("missing-code");
  try {
    const visitor = await identity();
    if (state && state !== visitor) return home("state-mismatch");
    const token = await exchangeToken(code);
    saveOAuthSession(visitor, token.accessToken, token.expiresIn);
    return home("ok");
  } catch {
    // 换取失败不给用户暴露细节，回到登录页重试。
    return home("token-failed");
  }
}
