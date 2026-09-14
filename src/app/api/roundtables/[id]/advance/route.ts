import { z } from "zod";
import { body, handle, identity, type RouteContext } from "@/lib/server/http";
import { advance } from "@/lib/server/roundtables";
export const runtime = "nodejs";
const controlSchema = z.object({
  requestId: z.string().min(8).max(64),
  revision: z.number().int().min(0),
});
export async function POST(request: Request, context: RouteContext) {
  return handle(async () => {
    const input = await body(request, controlSchema);
    return advance((await context.params).id, await identity(), input);
  });
}
