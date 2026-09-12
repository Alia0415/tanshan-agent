import { handle, identity, type RouteContext } from "@/lib/server/http";
import { readRoundtable } from "@/lib/server/roundtables";
export const runtime = "nodejs";
export async function GET(_request: Request, context: RouteContext) {
  return handle(async () => ({
    roundtable: readRoundtable((await context.params).id, await identity()),
  }));
}
