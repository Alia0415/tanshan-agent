import { handle, identity, type RouteContext } from "@/lib/server/http";
import { getSession } from "@/lib/server/store";
export const runtime = "nodejs";
export async function GET(_request: Request, context: RouteContext) {
  return handle(async () => ({
    session: getSession((await context.params).id, await identity()),
  }));
}
