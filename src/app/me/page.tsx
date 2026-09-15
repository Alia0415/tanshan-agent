"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { LogOut, ArrowRight } from "lucide-react";
import { useZhihuAccount, ZhihuAvatar } from "@/components/zhihu-account";
import { safeWebUrl } from "@/lib/domain/zhihu-user";

type Item = { Url?: string; Title?: string; Fullname?: string; AvatarUrl?: string; Headline?: string; Summary?: string; Description?: string; ContentType?: string; LikeCount?: number; FollowerCount?: number; CreatedAt?: number };
type Section = "contents" | "followees" | "favlists" | "collections";
const sections: { key: Section; label: string }[] = [{ key: "contents", label: "我的创作" }, { key: "followees", label: "我的关注" }, { key: "favlists", label: "收藏夹" }, { key: "collections", label: "近期收藏" }];
const types: Record<string, string> = { answer: "回答", article: "文章", question: "问题", pin: "想法", zvideo: "视频" };
const messages: Record<string, string> = { ok: "知乎登录成功。", "missing-code": "未完成知乎授权，请重新登录。", "state-mismatch": "登录请求已失效，请重新登录。", "token-failed": "知乎登录未完成，请重试。", "not-configured": "知乎登录暂未开放，请稍后再试。" };

function UserContent({ onExpired }: { onExpired: () => void }) {
  const [section, setSection] = useState<Section>("contents");
  const [items, setItems] = useState<Item[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const load = useCallback(async (key: Section, offset = "0", append = false) => {
    if (append && inFlight.current) return;
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    inFlight.current = true; setLoading(true); setError("");
    if (!append) { setSection(key); setItems([]); setNext(null); setLoaded(false); }
    try {
      const params = new URLSearchParams({ Limit: "20", Offset: offset });
      const response = await fetch("/api/me/" + key + "?" + params, { cache: "no-store", signal: controller.signal });
      const result = await response.json();
      if (!response.ok || result.Code !== 0) {
        if (response.status === 401) onExpired();
        throw new Error(result.error?.message || "读取失败，请稍后重试。");
      }
      if (!Array.isArray(result.Data?.Items)) throw new Error("返回内容格式异常，请稍后重试。");
      const page = result.Data.Paging;
      let cursor: string | null = null;
      if ((key === "contents" || key === "followees") && page?.IsEnd === false) {
        if (typeof page.NextOffset !== "string" || !/^\d+$/.test(page.NextOffset) || BigInt(page.NextOffset) > 9223372036854775807n || BigInt(page.NextOffset) <= BigInt(offset)) throw new Error("分页信息异常，请稍后重试。");
        cursor = page.NextOffset;
      } else if ((key === "contents" || key === "followees") && page?.IsEnd !== true) throw new Error("分页信息缺失，请稍后重试。");
      if (controller.signal.aborted) return;
      setItems((previous) => append ? [...previous, ...result.Data.Items.filter((item: Item) => !item.Url || !previous.some((old) => old.Url === item.Url))] : result.Data.Items);
      setNext(cursor); setLoaded(true);
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "读取失败"); }
    finally { if (!controller.signal.aborted) { inFlight.current = false; setLoading(false); } }
  }, [onExpired]);
  useEffect(() => { const timer = setTimeout(() => void load("contents"), 0); return () => { clearTimeout(timer); active.current?.abort(); }; }, [load]); // Initial page only; tabs and pagination are explicit user actions.
  return <section className="me-card me-sections" aria-label="我的知乎内容">
    <div className="me-tabs" role="tablist" aria-label="内容类型">{sections.map(({ key, label }) => <button id={"tab-" + key} role="tab" aria-selected={section === key} aria-controls="user-content" className={section === key ? "on" : ""} key={key} onClick={() => void load(key)}>{label}</button>)}</div>
    <div id="user-content" role="tabpanel" aria-labelledby={"tab-" + section} aria-busy={loading}>
      {section === "collections" && <p className="me-empty">展示近期收藏，不代表全部收藏记录。</p>}
      <ul className="me-list">{items.map((item, index) => {
        const title = item.Title || item.Fullname || "未命名内容";
        const url = safeWebUrl(item.Url);
        return <li key={(item.Url || title) + index} className="me-content-item">
          {section === "followees" && <ZhihuAvatar src={item.AvatarUrl} name={title} />}
          <div className="me-content-text">{url ? <a href={url} target="_blank" rel="noreferrer">{title}</a> : <strong>{title}</strong>}
            <p>{item.Summary || item.Headline || item.Description || ""}</p>
            <small>{[item.ContentType ? types[item.ContentType] || "创作" : "", typeof item.LikeCount === "number" ? item.LikeCount + " 赞" : "", typeof item.FollowerCount === "number" ? item.FollowerCount + " 粉丝" : ""].filter(Boolean).join(" · ")}</small>
          </div>
        </li>;
      })}</ul>
      {error && <p className="me-notice" role="alert">{error} <button className="me-ghost" disabled={loading} onClick={() => void load(section, next || "0", loaded && next !== null)}>重试</button></p>}
      <div aria-live="polite">{loading && <p className="me-empty">正在读取…</p>}{!loading && loaded && items.length === 0 && !error && <p className="me-empty">暂时没有可展示的公开内容。</p>}</div>
      {next && !error && <button className="me-ghost me-load-more" disabled={loading} onClick={() => void load(section, next, true)}>{loading ? "加载中…" : "加载更多"}</button>}
      {loaded && !next && items.length > 0 && !error && <p className="me-empty">已显示全部可用内容</p>}
    </div>
  </section>;
}
export default function MePage() {
  const { status, error, refresh } = useZhihuAccount();
  const [notice, setNotice] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  useEffect(() => { const timer = setTimeout(() => { const value = new URLSearchParams(window.location.search).get("oauth"); if (value) { setNotice(messages[value] || ""); window.history.replaceState(null, "", "/me"); } }, 0); return () => clearTimeout(timer); }, []);
  const onExpired = useCallback(() => { setNotice("知乎授权已失效，请重新登录。"); void refresh(); }, [refresh]);
  async function logout() {
    setLoggingOut(true);
    try { const response = await fetch("/api/oauth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); if (!response.ok) throw new Error(); await refresh(); setNotice("已退出知乎登录。"); }
    catch { setNotice("退出失败，请重试。"); } finally { setLoggingOut(false); }
  }
  const user = status?.user;
  return <main className="me-page">
    <section className="me-card me-head">
      <Link className="me-brand" href="/">探山 · 个人中心</Link>
      {status?.loggedIn && user ? <><div className="me-profile"><ZhihuAvatar key={user.avatar} src={user.avatar} name={user.name} large /><div><h1>{user.name}</h1><p>{user.headline || "欢迎来到你的知乎空间"}</p></div></div>{user.description && <p className="me-description">{user.description}</p>}
      <div className="me-actions"><span className="me-badge">知乎已连接</span><button className="me-ghost" disabled={loggingOut} onClick={() => void logout()}><LogOut size={14} />{loggingOut ? "退出中…" : "退出登录"}</button></div></> : <><h1>我的知乎</h1><p>连接知乎账号，在这里查看你的个人资料、创作和关注。</p><div className="me-actions">{status?.configured ? <a className="me-primary" href="/api/oauth/authorize">使用知乎登录 <ArrowRight size={15} /></a> : <span className="me-empty">{status ? "知乎登录暂未开放" : "正在读取登录状态…"}</span>}</div></>}
      {notice && <p className="me-notice" role="status">{notice}</p>}
      {error && <p role="alert" className="me-notice">{error}<button className="me-ghost" onClick={() => void refresh()}>重试</button></p>}
      <Link className="me-bookmarks-link" href="/?bookmarks=1">我的探山收藏夹 →</Link>
    </section>
    {status?.loggedIn && user && <UserContent key={user.id} onExpired={onExpired} />}
  </main>;
}
