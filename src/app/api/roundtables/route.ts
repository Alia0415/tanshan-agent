import { z } from "zod";
import { body, handle, identity } from "@/lib/server/http";
import { startRoundtable } from "@/lib/server/roundtables";
export const runtime = "nodejs";
const createSchema = z.object({
  question: z.string().trim().min(5).max(200),
});
export async function POST(request: Request) {
  return handle(async () => {
    const input = await body(request, createSchema);
    return startRoundtable(input.question, await identity(true));
  }, 201);
}
