import { getQuestion, questionId, search, textOnly } from "@/lib/reading/discovery";
import { getDemoTopic } from "@/lib/reading/demo";
import { isPublicDemo } from "@/lib/server/public-demo";
export async function GET(_request: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const {id} = await params;
    const question = await getQuestion(id);
    if (!question) return Response.json({error: "问题不存在。"}, {status: 404});
    if (isPublicDemo()) {
      const answers = getDemoTopic(id)!.sources.map(item => ({ url: item.Url, author: item.AuthorName, excerpt: item.ContentText, votes: 0 }));
      return Response.json({ answers, demo: true });
    }
    const items = await search(question.title);
    const answers = items.filter(item => questionId(item.Url) === id && item.ContentType === "Answer")
      .map(item => ({url: item.Url, author: textOnly(item.AuthorName) || "知乎用户", excerpt: textOnly(item.ContentText), votes: item.VoteUpCount}));
    return Response.json({answers});
  } catch {
    return Response.json({error: "回答摘要暂时无法加载，可前往知乎阅读完整回答。"}, {status: 503});
  }
}
