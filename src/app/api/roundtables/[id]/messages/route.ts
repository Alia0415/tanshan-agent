import { z } from "zod";
import { body, handle, identity, type RouteContext } from "@/lib/server/http";
import { postMessage } from "@/lib/server/roundtables";
export const runtime = "nodejs";
const messageSchema = z.object({
  content: z.string().trim().min(1).max(300),
});
export async function POST(request: Request, context: RouteContext) {
  return handle(async () => {
    const input = await body(request, messageSchema);
    return postMessage(
      (await context.params).id,
      await identity(),
      input.content,
    );
  });
}
