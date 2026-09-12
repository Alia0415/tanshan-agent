import { AppError, createSchema } from "@/lib/domain/validation";
import { listSessions } from "@/lib/server/store";
import { body, handle, identity } from "@/lib/server/http";
import { createSession } from "@/lib/server/sessions";
export const runtime = "nodejs";
export async function GET() {
  return handle(async () => {
    let token: string;
    try {
      token = await identity();
    } catch (error) {
      if (error instanceof AppError && error.code === "SESSION_NOT_FOUND") return { sessions: [] };
      throw error;
    }
    return { sessions: listSessions(token) };
  });
}
export async function POST(request: Request) {
  return handle(async () => {
    const input = await body(request, createSchema);
    return createSession(input.question, await identity(true));
  }, 201);
}
