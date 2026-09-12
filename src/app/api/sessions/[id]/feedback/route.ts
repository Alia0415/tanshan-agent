import { feedbackSchema } from "@/lib/domain/validation";
import { body, handle, identity, type RouteContext } from "@/lib/server/http";
import { addFeedback } from "@/lib/server/sessions";
export const runtime = "nodejs";
export async function POST(request: Request, context: RouteContext) {
  return handle(async () =>
    addFeedback(
      (await context.params).id,
      await identity(),
      await body(request, feedbackSchema),
    ),
  );
}
