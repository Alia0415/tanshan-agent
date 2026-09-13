import { handle, identity } from "@/lib/server/http";
import { favlistQuerySchema } from "@/lib/server/user-api-routes";
import { fetchUserApi, requireOAuthSession } from "@/lib/server/oauth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return handle(async () => {
    const visitor = await identity();
    const session = requireOAuthSession(visitor);
    const query = favlistQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const params = new URLSearchParams({
      FavlistUrlToken: String(query.FavlistUrlToken),
    });
    if (query.Offset !== undefined) params.set("Offset", String(query.Offset));
    if (query.Limit !== undefined) params.set("Limit", String(query.Limit));
    return fetchUserApi(
      "/api/v1/user/favlist_contents?" + params.toString(),
      session.accessToken,
    );
  });
}
