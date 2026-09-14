import { body, handle, identity } from "@/lib/server/http";
import {
  connectResonance,
  resonanceInputSchema,
} from "@/lib/server/resonance";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handle(async () => {
    const input = await body(request, resonanceInputSchema);
    return connectResonance(input, await identity(true));
  });
}
