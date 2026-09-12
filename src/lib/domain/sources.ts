import type { Source } from "./types";

// Accept direct post links, not redirects, profiles, search pages, or look-alike domains.
export function isZhihuPostUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port
    )
      return false;
    if (url.hostname === "zhuanlan.zhihu.com")
      return /^\/p\/\d+\/?$/.test(url.pathname);
    return (
      ["zhihu.com", "www.zhihu.com"].includes(url.hostname) &&
      /^\/(?:question\/\d+(?:\/answer\/\d+)?|answer\/\d+)\/?$/.test(
        url.pathname,
      )
    );
  } catch {
    return false;
  }
}

export function isZhihuPost(source: Source): boolean {
  return (
    source.channel !== "global" &&
    ["answer", "article", "question"].includes(source.type.toLowerCase()) &&
    isZhihuPostUrl(source.url)
  );
}

export const filterZhihuPosts = (sources: Source[]): Source[] =>
  sources.filter(isZhihuPost);

export function sourceSignals(source: Source): string {
  const parts: string[] = [];
  for (const [count, label] of [[source.comment_count, "评论"], [source.vote_up_count, "赞同"]] as const) {
    if (count !== undefined && Number.isSafeInteger(count) && count >= 0)
      parts.push(`${count.toLocaleString("zh-CN")} ${label}`);
  }
  if (source.updated_at) parts.push(`更新于 ${source.updated_at.slice(0, 10)}`);
  return parts.join(" · ");
}

export function previewExcerpt(source: Source, limit = 240): string {
  const match = source.relevance?.evidence;
  const index = match ? source.excerpt.indexOf(match) : -1;
  const start = index < 0 ? 0 : Math.max(0, index - 60);
  return `${start ? "…" : ""}${source.excerpt.slice(start, start + limit)}${source.excerpt.length > start + limit ? "…" : ""}`;
}
