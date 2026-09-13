import { proxyUserApi } from "@/lib/server/user-api-routes";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  // ContentType 为知乎接口必填项，默认取全部创作。
  const params = new URLSearchParams(url.searchParams);
  if (!params.get("ContentType")) params.set("ContentType", "all");
  return proxyUserApi("/api/v1/user/contents", params);
}
