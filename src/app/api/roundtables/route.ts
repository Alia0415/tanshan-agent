import { z } from "zod";
import { body, handle, identity } from "@/lib/server/http";
import { startRoundtable } from "@/lib/server/roundtables";
import { AppError } from "@/lib/domain/validation";
export const runtime = "nodejs";
const createSchema = z.object({
  question: z.string().trim().min(5).max(200),
});
export async function POST(request: Request) {
  if (request.headers.get("accept")?.includes("application/x-ndjson")) {
    try {
      const input = await body(request, createSchema);
      const token = await identity(true);
      let closed = false;
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          const send = (event: unknown) => {
            if (!closed) controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
          };
          void startRoundtable(input.question, token, (message, sources) => {
            send({ type: "progress", message, sources: sources?.map(({ id, title, url }) => ({ id, title, url })) });
          }).then((round) => send({ type: "complete", round }))
            .catch((error: unknown) => send({ type: "error", message: error instanceof AppError ? error.message : "服务暂时无法完成请求，请稍后重试。" }))
            .finally(() => { if (!closed) { closed = true; controller.close(); } });
        },
        cancel() { closed = true; },
      });
      return new Response(stream, { headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
      } });
    } catch (error) {
      return handle(async () => { throw error; });
    }
  }
  return handle(async () => {
    const input = await body(request, createSchema);
    return startRoundtable(input.question, await identity(true));
  }, 201);
}
