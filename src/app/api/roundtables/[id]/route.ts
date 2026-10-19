import { z } from "zod";
import { body, handle, identity, type RouteContext } from "@/lib/server/http";
import { readRoundtable } from "@/lib/server/roundtables";
import { roundtableCheckpointSchema, ROUNDTABLE_BODY_LIMIT } from "@/lib/server/roundtable-transport";
export const runtime = "nodejs";
export async function GET(_request: Request, context: RouteContext) {
  return handle(async () => ({
    roundtable: readRoundtable((await context.params).id, await identity()),
  }));
}

export async function POST(request: Request, context: RouteContext) {
  return handle(async () => {
    const input = await body(request, z.object({ checkpoint: roundtableCheckpointSchema }), ROUNDTABLE_BODY_LIMIT);
    return { roundtable: readRoundtable((await context.params).id, await identity(), input.checkpoint) };
  });
}
