import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { body, handle } from "@/lib/server/http";
import { bookmarkActionSchema } from "@/lib/domain/bookmarks";
import { changeBookmarks, listBookmarks } from "@/lib/server/bookmarks";

export const runtime = "nodejs";
async function owner() {
  const jar = await cookies();
  const existing = jar.get("wenshan_bookmarks")?.value;
  const token = existing && /^[a-f0-9]{64}$/.test(existing) ? existing : randomBytes(32).toString("hex");
  jar.set("wenshan_bookmarks", token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 365 * 86400 });
  return token;
}
export async function GET() { return handle(async () => ({ folders: listBookmarks(await owner()) })); }
export async function POST(request: Request) {
  return handle(async () => {
    const action = await body(request, bookmarkActionSchema);
    return { folders: changeBookmarks(await owner(), action) };
  });
}
