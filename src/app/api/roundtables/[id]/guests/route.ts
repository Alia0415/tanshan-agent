import { z } from "zod";
import { body, handle, identity, type RouteContext } from "@/lib/server/http";
import { inviteGuest } from "@/lib/server/roundtables";
import { roundtableCheckpointSchema, ROUNDTABLE_BODY_LIMIT } from "@/lib/server/roundtable-transport";
export const runtime = "nodejs";
const schema = z.object({ guestId: z.enum(["guest-counter", "guest-evidence", "guest-context"]), checkpoint: roundtableCheckpointSchema });
export async function POST(request: Request, context: RouteContext) {
  return handle(async () => {
    const input = await body(request, schema, ROUNDTABLE_BODY_LIMIT);
    return inviteGuest((await context.params).id, await identity(), input.guestId, input.checkpoint);
  });
}
