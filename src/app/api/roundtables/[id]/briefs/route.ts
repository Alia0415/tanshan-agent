import { z } from "zod";
import { body, handle, identity, type RouteContext } from "@/lib/server/http";
import { completeBriefs, completeEvidence, readRoundtable } from "@/lib/server/roundtables";
import { roundtableCheckpointSchema, ROUNDTABLE_BODY_LIMIT } from "@/lib/server/roundtable-transport";
export const runtime = "nodejs";
export async function POST(request: Request, context: RouteContext) {
  return handle(async () => {
    const input = await body(request, z.object({ ids: z.array(z.string().max(80)).min(1).max(30), kind: z.enum(["claim", "evidence"]).optional(), checkpoint: roundtableCheckpointSchema, includeRound: z.boolean().optional() }), ROUNDTABLE_BODY_LIMIT);
    const id = (await context.params).id;
    const token = await identity();
    const summaries = input.kind === "evidence"
      ? await completeEvidence(id, token, input.ids, input.checkpoint)
      : await completeBriefs(id, token, input.ids, input.checkpoint);
    return input.includeRound ? { summaries, roundtable: readRoundtable(id, token) } : summaries;
  });
}
