import { isPublicDemo } from "@/lib/server/public-demo";
import { db } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    db().prepare("SELECT 1").get();
    return Response.json({ status: "ok", mode: isPublicDemo() ? "demo" : "standard", aiEnabled: Boolean(process.env.DEEPSEEK_API_KEY?.trim()) }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
