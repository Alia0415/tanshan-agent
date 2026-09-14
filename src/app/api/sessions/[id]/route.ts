import { z } from "zod";
import { body, handle, identity, type RouteContext } from "@/lib/server/http";
import { deleteSession, getSession } from "@/lib/server/store";
export const runtime = "nodejs";
export async function GET(_request: Request, context: RouteContext) {
  return handle(async () => ({
    session: getSession((await context.params).id, await identity()),
  }));
}

export async function DELETE(request: Request, context: RouteContext) {
  return handle(async () => {
    await body(request, z.object({}).strict());
    deleteSession((await context.params).id, await identity());
    return { deleted: true };
  });
}
