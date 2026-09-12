import { handle, identity, type RouteContext } from "@/lib/server/http";
import { advance } from "@/lib/server/roundtables";
export const runtime = "nodejs";
export async function POST(_request: Request, context: RouteContext) {
  return handle(
    async () => advance((await context.params).id, await identity()),
  );
}
