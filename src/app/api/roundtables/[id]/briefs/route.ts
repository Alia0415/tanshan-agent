import { z } from "zod";
import { body, handle, identity, type RouteContext } from "@/lib/server/http";
import { completeBriefs } from "@/lib/server/roundtables";
export const runtime = "nodejs";
export async function POST(request: Request, context: RouteContext) {
  return handle(async () => {
    const input = await body(request, z.object({ ids: z.array(z.string().max(80)).min(1).max(30) }));
    return completeBriefs((await context.params).id, await identity(), input.ids);
  });
}