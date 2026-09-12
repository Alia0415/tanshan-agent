import { patchSchema } from "@/lib/domain/validation";
import { body, handle, identity, type RouteContext } from "@/lib/server/http";
import { updateContext } from "@/lib/server/sessions";
export const runtime = "nodejs";
export async function PATCH(request: Request, context: RouteContext) {
  return handle(async () =>
    updateContext(
      (await context.params).id,
      await identity(),
      await body(request, patchSchema),
    ),
  );
}
