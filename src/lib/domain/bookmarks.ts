import { z } from "zod";
import { isZhihuPostUrl } from "./sources";

export function canonicalPostUrl(value: string) {
  const url = new URL(value);
  const answer = url.pathname.match(/\/answer\/(\d+)/);
  return answer ? `https://www.zhihu.com/answer/${answer[1]}` : `https://${url.hostname === "zhihu.com" ? "www.zhihu.com" : url.hostname}${url.pathname.replace(/\/$/, "")}`;
}
export const bookmarkPostSchema = z.object({
  url: z.string().max(2048).refine(isZhihuPostUrl, "请选择有效的知乎帖子").transform(canonicalPostUrl),
  title: z.string().trim().min(1).max(500),
  author: z.string().max(200).default(""),
  excerpt: z.string().max(6000).default(""),
});
export type BookmarkPost = z.input<typeof bookmarkPostSchema>;
export type BookmarkFolder = { id: string; name: string; posts: Array<z.output<typeof bookmarkPostSchema>> };
const name = z.string().trim().min(1, "请输入收藏夹名称").max(40, "收藏夹名称最多 40 字");
export const bookmarkActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), name, post: bookmarkPostSchema.optional() }),
  z.object({ action: z.literal("rename"), id: z.string().uuid(), name }),
  z.object({ action: z.literal("delete"), id: z.string().uuid() }),
  z.object({ action: z.literal("save"), id: z.string().uuid(), post: bookmarkPostSchema }),
  z.object({ action: z.literal("remove"), id: z.string().uuid(), url: bookmarkPostSchema.shape.url }),
]);
