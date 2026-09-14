import { NextResponse } from "next/server";
import { identity } from "@/lib/server/http";
import { buildAuthorizeUrl, oauthConfig } from "@/lib/server/oauth";

export const runtime = "nodejs";

export async function GET() {
  const config = oauthConfig();
  if (!config.configured)
    return new Response(null, {
      status: 307,
      headers: { Location: "/me?oauth=not-configured" },
    });
  // state 使用访客令牌：回调时校验同一浏览器，防串号。
  const visitor = await identity(true);
  return NextResponse.redirect(buildAuthorizeUrl(config, visitor));
}
