import { z } from "zod";
import { body, handle, identity, type RouteContext } from "@/lib/server/http";
import { inviteGuest } from "@/lib/server/roundtables";
export const runtime = "nodejs";
const schema = z.object({ guestId: z.enum(["guest-counter", "guest-evidence", "guest-context"]) });
export async function POST(request: Request, context: RouteContext) {
  return handle(async () => {
    const input = await body(request, schema);
    return inviteGuest((await context.params).id, await identity(), input.guestId);
  });
}
