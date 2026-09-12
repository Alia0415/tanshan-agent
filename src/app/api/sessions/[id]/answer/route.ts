import { after } from "next/server";
import { answerSchema } from "@/lib/domain/validation";
import { body, handle, identity, type RouteContext } from "@/lib/server/http";
import { claimAnswer, runAnswer } from "@/lib/server/sessions";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: Request, context: RouteContext) {
  return handle(async () => {
    const { id } = await context.params;
    const input = await body(request, answerSchema);
    const claim = claimAnswer(
      id,
      await identity(),
      input.context_version,
      input.request_id,
    );
    if (claim.start)
      after(() => runAnswer(id, input.context_version, input.request_id));
    return { session: claim.session };
  }, 202);
}
