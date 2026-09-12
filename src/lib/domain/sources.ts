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
