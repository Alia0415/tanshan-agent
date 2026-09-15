export type ZhihuUser = { id: string; name: string; avatar: string; headline: string; description: string };
export type OAuthStatus = { configured: boolean; loggedIn: boolean; expiresIn: number; user: ZhihuUser | null };
export function safeWebUrl(value: unknown) {
  if (typeof value !== "string") return "";
  try { const url = new URL(value); return url.protocol === "https:" ? url.toString() : ""; } catch { return ""; }
}
