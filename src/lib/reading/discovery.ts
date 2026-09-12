import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type Question = {
  id: string; title: string; url: string; summary: string;
  firstSeenHot?: string; lastSeenHot?: string; rank?: number;
};
type Catalog = { updatedAt: number; questions: Record<string, Question>; hotIds: string[] };
const file = path.join(process.cwd(), ".data", "questions.json");
let writes = Promise.resolve();
let hotPending: Promise<Catalog> | undefined;
export function textOnly(value: unknown): string {
  return typeof value === "string" ? value.replace(/<[^>]*>/g, "").trim() : "";
}
export function questionId(url: unknown): string | undefined {
  try {
    const parsed = new URL(String(url));
    if (parsed.protocol !== "https:" || !["www.zhihu.com", "zhihu.com"].includes(parsed.hostname)) return;
    return parsed.pathname.match(/^\/question\/(\d+)(?:\/|$)/)?.[1];
  } catch { return; }
}
export async function api<T>(endpoint: string): Promise<T> {
  const secret = process.env.ZHIHU_ACCESS_SECRET;
  if (!secret) throw new Error("知乎服务尚未配置，请联系维护者。");
  const response = await fetch("https://developer.zhihu.com" + endpoint, {
    headers: { Authorization: "Bearer " + secret, "X-Request-Timestamp": String(Math.floor(Date.now()/1000)) },
    cache: "no-store", signal: AbortSignal.timeout(25000),
  }).catch(() => { throw new Error("暂时无法连接知乎服务，请稍后重试。"); });
  if (!response.ok) throw new Error(response.status === 429 ? "知乎请求频繁，请稍后再试。" : "知乎服务暂时不可用。");
  const body = await response.json();
  if (body.Code !== 0) throw new Error(body.Code === 30001 ? "知乎请求频繁或额度受限，请稍后再试。" : "知乎服务暂时不可用。");
  return body.Data as T;
}
export async function readCatalog(): Promise<Catalog> {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { updatedAt: 0, questions: {}, hotIds: [] };
  }
}
async function updateCatalog(update: (value: Catalog) => void) {
  const task = writes.then(async () => {
    const data = await readCatalog(); update(data);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file + ".tmp", JSON.stringify(data), "utf8");
    await rename(file + ".tmp", file);
  });
  writes = task.catch(() => {});
  await task;
}
export async function hotCatalog(): Promise<Catalog> {
  const cached = await readCatalog();
  if (Date.now() - cached.updatedAt < 5 * 60000) return cached;
  if (!hotPending) hotPending = (async () => {
    const result = await api<{Items: Array<{Title: string; Url: string; Summary: string}>}>("/api/v1/content/hot_list?Limit=30");
    if (!Array.isArray(result.Items)) throw new Error("热榜数据暂不可用。");
    await updateCatalog(data => {
      const now = new Date().toISOString();
      data.hotIds = [];
      result.Items.forEach((item, index) => {
        const id = questionId(item.Url);
        if (!id || !item.Title) return;
        data.hotIds.push(id);
        data.questions[id] = {
          id, title: textOnly(item.Title), summary: textOnly(item.Summary), url: item.Url,
          firstSeenHot: data.questions[id]?.firstSeenHot || now, lastSeenHot: now, rank: index + 1,
        };
      });
      data.updatedAt = Date.now();
    });
    return readCatalog();
  })().finally(() => { hotPending = undefined; });
  return hotPending;
}
type SearchItem = {Title: string; Url: string; ContentText: string; AuthorName: string; VoteUpCount: number; ContentType: string};
const searches = new Map<string, {until: number; promise: Promise<SearchItem[]>}>();
export async function search(query: string) {
  const existing = searches.get(query);
  if (existing && existing.until > Date.now()) return existing.promise;
  const promise = api<{Items: SearchItem[]}>("/api/v1/content/zhihu_search?" + new URLSearchParams({Query: query, Count: "10"}))
    .then(data => { if (!Array.isArray(data.Items)) throw new Error("搜索结果暂不可用。"); return data.Items; })
    .catch(error => { searches.delete(query); throw error; });
  if (searches.size > 100) searches.clear();
  searches.set(query, {until: Date.now() + 10 * 60000, promise});
  return promise;
}
export async function searchQuestions(query: string) {
  const items = await search(query);
  const ids = [...new Set(items.map(item => questionId(item.Url)).filter((id): id is string => !!id))];
  await updateCatalog(data => {
    for (const id of ids) {
      if (data.questions[id]) continue;
      const item = items.find(item => questionId(item.Url) === id)!;
      data.questions[id] = {id, title: textOnly(item.Title).replace(/\s*-\s*知乎\s*$/, ""), summary: "", url: "https://www.zhihu.com/question/" + id};
    }
  });
  const catalog = await readCatalog();
  return ids.map(id => catalog.questions[id]);
}
export async function getQuestion(id: string) {
  if (!/^\d+$/.test(id)) return undefined;
  return (await readCatalog()).questions[id];
}
export function eligible(question: Question) { return Boolean(question.firstSeenHot); }
