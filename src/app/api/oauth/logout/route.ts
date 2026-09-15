import { z } from "zod";
import { body, handle, identity } from "@/lib/server/http";
import { clearOAuthSession } from "@/lib/server/oauth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handle(async () => {
    await body(request, z.object({}).strict());
    const visitor = await identity();
    clearOAuthSession(visitor);
    return { loggedIn: false };
  });
}
