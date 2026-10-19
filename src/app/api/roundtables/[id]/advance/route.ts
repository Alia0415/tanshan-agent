import { z } from "zod";
import { body, handle, identity, type RouteContext } from "@/lib/server/http";
import { advance } from "@/lib/server/roundtables";
import { roundtableCheckpointSchema, ROUNDTABLE_BODY_LIMIT } from "@/lib/server/roundtable-transport";
export const runtime = "nodejs";
export async function POST(request: Request, context: RouteContext) {
  return handle(async () => {
    const input = await body(request, z.object({ expectedTurn: z.number().int().nonnegative(), checkpoint: roundtableCheckpointSchema }), ROUNDTABLE_BODY_LIMIT);
    return advance((await context.params).id, await identity(), input.expectedTurn, undefined, input.checkpoint);
  });
}
