import { NextResponse } from "next/server";
import { identity } from "@/lib/server/http";
import { buildAuthorizeUrl, createOAuthState, oauthConfig } from "@/lib/server/oauth";

export const runtime = "nodejs";

export async function GET() {
  const config = oauthConfig();
  if (!config.configured)
    return new Response(null, {
      status: 307,
      headers: { Location: "/me?oauth=not-configured" },
    });
  // 每次授权生成独立、短期、一次性的 state。
  const visitor = await identity(true);
  const response = NextResponse.redirect(buildAuthorizeUrl(config, createOAuthState(visitor)));
  response.headers.set("Cache-Control", "no-store");
  return response;
}
