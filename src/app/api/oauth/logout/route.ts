import { handle, identity } from "@/lib/server/http";
import { clearOAuthSession } from "@/lib/server/oauth";

export const runtime = "nodejs";

export async function POST() {
  return handle(async () => {
    const visitor = await identity();
    clearOAuthSession(visitor);
    return { loggedIn: false };
  });
}
