"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, LogOut, Mountain, ShieldCheck } from "lucide-react";

type Status = {
  configured: boolean;
  appId: string | null;
  appKeyConfigured: boolean;
  redirectUri: string | null;
  loggedIn: boolean;
  expiresIn: number;
};

const OAuthMessages: Record<string, string> = {
  ok: "知乎授权成功，可以查看你的创作、关注与收藏了。",
  "missing-code": "知乎没有返回授权码，请重新发起登录。",
  "state-mismatch": "登录状态校验失败，请在同一浏览器重试。",
  "token-failed": "换取授权失败，请重新发起登录。",
  "not-configured": "服务端尚未配置 App ID / App Key / 回调地址。",
};

function formatRemaining(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours} 小时 ${minutes} 分钟` : `${minutes} 分钟`;
}

export default function MePage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [notice, setNotice] = useState("");
  const [section, setSection] = useState<string>("");
  const [items, setItems] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const oauth = new URLSearchParams(window.location.search).get("oauth");
    fetch("/api/oauth/status", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || "读取状态失败");
        return data as Status;
      })
      .then(setStatus)
      .catch((cause: Error) => setNotice(cause.message))
      .finally(() => {
        if (oauth) setNotice(OAuthMessages[oauth] ?? "");
      });
  }, []);

  const load = useCallback(async (key: string, path: string) => {
    setLoading(true);
    setError("");
    setSection(key);
    setItems([]);
    try {
      const response = await fetch(path, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || "读取失败");
      const payload = data.Data ?? data;
      setItems(Array.isArray(payload) ? payload : payload.Items ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  async function logout() {
    await fetch("/api/oauth/logout", { method: "POST" }).catch(() => {});
    setStatus((previous) => (previous ? { ...previous, loggedIn: false } : previous));
    setNotice("已退出知乎登录。");
    setSection("");
    setItems([]);
  }

  const loggedIn = status?.loggedIn ?? false;

  return (
    <main className="me-page">
      <div className="me-card me-head">
        <Link className="me-brand" href="/">
          <Mountain size={18} aria-hidden="true" />
          问山
        </Link>
        <h1>我的知乎</h1><Link href="/?bookmarks=1">我的问山收藏夹 →</Link>
        <p>
          用知乎账号登录后，可以在这里查看你授权范围内的创作、关注与收藏。
          凭证只保存在服务端，24 小时内有效。
        </p>
        {notice && (
          <p className={notice.includes("成功") ? "me-notice ok" : "me-notice"}>
            {notice}
          </p>
        )}
        <div className="me-actions">
          {!loggedIn ? (
            <a className="me-primary" href="/api/oauth/authorize">
              登录知乎账号
              <ArrowRight size={15} aria-hidden="true" />
            </a>
          ) : (
            <>
              <span className="me-badge">
                <CheckCircle2 size={14} aria-hidden="true" />
                已登录 · 剩余 {formatRemaining(status?.expiresIn ?? 0)}
              </span>
              <button type="button" className="me-ghost" onClick={() => void logout()}>
                <LogOut size={14} aria-hidden="true" />
                退出登录
              </button>
            </>
          )}
        </div>
        {status && !status.configured && (
          <p className="me-notice">
            <ShieldCheck size={13} aria-hidden="true" />
            服务端缺少 App ID / App Key / 回调地址配置，真实登录需先部署并登记回调。
          </p>
        )}
      </div>

      <div className="me-card me-sections">
        <h2>授权内容</h2>
        <div className="me-tabs">
          <button
            type="button"
            className={section === "contents" ? "on" : ""}
            disabled={!loggedIn || loading}
            onClick={() => void load("contents", "/api/me/contents?Limit=20")}
          >
            我的创作
          </button>
          <button
            type="button"
            className={section === "followees" ? "on" : ""}
            disabled={!loggedIn || loading}
            onClick={() => void load("followees", "/api/me/followees?Limit=20")}
          >
            我的关注
          </button>
          <button
            type="button"
            className={section === "favlists" ? "on" : ""}
            disabled={!loggedIn || loading}
            onClick={() => void load("favlists", "/api/me/favlists?Limit=20")}
          >
            收藏夹
          </button>
          <button
            type="button"
            className={section === "collections" ? "on" : ""}
            disabled={!loggedIn || loading}
            onClick={() => void load("collections", "/api/me/collections?Limit=20")}
          >
            近期收藏
          </button>
        </div>
        {!loggedIn && <p className="me-empty">登录后这里会展示你的知乎内容。</p>}
        {loading && <p className="me-empty">正在读取…</p>}
        {error && <p className="me-empty me-error">{error}</p>}
        {!loading && !error && items.length > 0 && (
          <ul className="me-list">
            {items.map((item, index) => {
              const record = item as Record<string, unknown>;
              const title =
                (record.Title as string) ||
                (record.Fullname as string) ||
                "（无标题）";
              const url = (record.Url as string) || "";
              const meta = [
                typeof record.LikeCount === "number" ? `${record.LikeCount} 赞` : "",
                typeof record.FollowerCount === "number"
                  ? `${record.FollowerCount} 粉丝`
                  : "",
                typeof record.ContentType === "string"
                  ? String(record.ContentType)
                  : "",
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <li key={index}>
                  {url ? (
                    <a href={url} target="_blank" rel="noreferrer">
                      {title}
                    </a>
                  ) : (
                    <span>{title}</span>
                  )}
                  {meta && <small>{meta}</small>}
                </li>
              );
            })}
          </ul>
        )}
        {!loading && !error && items.length === 0 && section && (
          <p className="me-empty">这部分暂时没有公开内容。</p>
        )}
      </div>
    </main>
  );
}
