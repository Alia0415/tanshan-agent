import { hotCatalog, searchQuestions } from "@/lib/discovery";
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim();
  if (query && query.length > 120) return Response.json({error: "搜索词请控制在 120 字内。"}, {status: 400});
  try {
    const catalog = await hotCatalog();
    const historical = new URL(request.url).searchParams.get("view") === "history";
    const questions = query ? await searchQuestions(query) : historical
      ? Object.values(catalog.questions).filter(question => question.firstSeenHot)
      : catalog.hotIds.map(id => catalog.questions[id]);
    return Response.json({questions, updatedAt: catalog.updatedAt}, {headers: {"Cache-Control": "no-store"}});
  } catch {
    return Response.json({error: "暂时无法获取问题，请稍后重试。"}, {status: 503});
  }
}
