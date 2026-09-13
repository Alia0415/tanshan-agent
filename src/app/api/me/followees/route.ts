import { proxyUserApi } from "@/lib/server/user-api-routes";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return proxyUserApi(
    "/api/v1/user/followees",
    new URL(request.url).searchParams,
  );
}
