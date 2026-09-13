import { NextResponse } from "next/server";
import { identity } from "@/lib/server/http";
import { buildAuthorizeUrl, oauthConfig } from "@/lib/server/oauth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const config = oauthConfig();
  if (!config.configured)
    return NextResponse.redirect(
      new URL("/me?oauth=not-configured", request.url),
    );
  // state 使用访客令牌：回调时校验同一浏览器，防串号。
  const visitor = await identity(true);
  return NextResponse.redirect(buildAuthorizeUrl(config, visitor));
}
