import { z } from "zod";
import { body, handle, identity, type RouteContext } from "@/lib/server/http";
import { choicesForTag } from "@/lib/server/revision-choices";
export const runtime = "nodejs";
const schema = z.object({ context_version: z.number().int().positive(), answer_id: z.string().uuid(), label: z.string().trim().min(1).max(2000) }).strict();
export async function POST(request: Request, context: RouteContext) {
  return handle(async () => {
    const input = await body(request, schema);
    return choicesForTag((await context.params).id, await identity(), input.context_version, input.answer_id, input.label);
  });
}
