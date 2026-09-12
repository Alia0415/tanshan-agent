import { createSchema } from "@/lib/domain/validation";
import { body, handle, identity } from "@/lib/server/http";
import { createSession } from "@/lib/server/sessions";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return handle(async () => {
    const input = await body(request, createSchema);
    return createSession(input.question, await identity(true));
  }, 201);
}
