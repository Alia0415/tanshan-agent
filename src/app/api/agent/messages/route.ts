import { agentMessageSchema, receiveAgentMessage } from "@/lib/agent/bridge";
import { body, handle, identity } from "@/lib/server/http";

// Cookie-authenticated local debugger, not an official Zhihu webhook.
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: Request) {
  return handle(async () => {
    const input = await body(request, agentMessageSchema);
    return receiveAgentMessage(input, await identity(!input.session_id));
  });
}
