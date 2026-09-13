import { handle, identity } from "@/lib/server/http";
import { getOAuthSession, oauthConfig } from "@/lib/server/oauth";

export const runtime = "nodejs";

export async function GET() {
  return handle(async () => {
    const config = oauthConfig();
    let loggedIn = false;
    let expiresIn = 0;
    try {
      const visitor = await identity();
      const session = getOAuthSession(visitor);
      if (session) {
        loggedIn = true;
        expiresIn = Math.max(
          0,
          Math.floor((session.expiresAt - Date.now()) / 1000),
        );
      }
    } catch {
      // 未初始化访客身份视为未登录
    }
    return {
      configured: config.configured,
      // App ID 公开无妨；App Key 只返回是否配置，不返回值。
      appId: config.appId || null,
      appKeyConfigured: Boolean(config.appKey),
      redirectUri: config.redirectUri || null,
      loggedIn,
      expiresIn,
    };
  });
}
