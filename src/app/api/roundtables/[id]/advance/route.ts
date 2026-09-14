import { z } from "zod";
import { body, handle, identity, type RouteContext } from "@/lib/server/http";
import { advance } from "@/lib/server/roundtables";
export const runtime = "nodejs";
export async function POST(request: Request, context: RouteContext) {
  return handle(async () => {
    const input = await body(request, z.object({ expectedTurn: z.number().int().nonnegative() }));
    return advance((await context.params).id, await identity(), input.expectedTurn);
  });
}
