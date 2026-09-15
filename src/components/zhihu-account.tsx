"use client";
import Image from "next/image";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { OAuthStatus } from "@/lib/domain/zhihu-user";
import { safeWebUrl } from "@/lib/domain/zhihu-user";
const Context = createContext<{ status: OAuthStatus | null; error: string; refresh: () => Promise<void> }>({ status: null, error: "", refresh: async () => {} });
export function ZhihuAccountProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<OAuthStatus | null>(null);
  const [error, setError] = useState("");
  const pathname = usePathname();
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/oauth/status", { cache: "no-store" });
      if (!response.ok) throw new Error("暂时无法读取登录状态，请重试。");
      setStatus(await response.json()); setError("");
    } catch { setError("暂时无法读取登录状态，请重试。"); }
  }, []);
  useEffect(() => { const timer = setTimeout(() => void refresh(), 0); return () => clearTimeout(timer); }, [refresh, pathname]);
  useEffect(() => {
    if (!status?.loggedIn) return;
    const timer = setTimeout(() => { void refresh(); }, Math.max(1, status.expiresIn) * 1000);
    return () => clearTimeout(timer);
  }, [refresh, status]);
  return <Context.Provider value={{ status, error, refresh }}>{children}</Context.Provider>;
}
export const useZhihuAccount = () => useContext(Context);
export function ZhihuAvatar({ src, name, large = false }: { src?: string; name: string; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  const url = safeWebUrl(src);
  return <span className={"zhihu-avatar" + (large ? " zhihu-avatar--large" : "")}>
    {url && !failed ? <Image unoptimized width={large ? 80 : 30} height={large ? 80 : 30} src={url} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : name.slice(0, 1)}
  </span>;
}
export function ZhihuAccountButton() {
  const { status } = useZhihuAccount();
  return status?.loggedIn && status.user ? <Link className="zhihu-account" href="/me" aria-label={"查看" + status.user.name + "的个人主页"}>
    <ZhihuAvatar key={status.user.avatar} src={status.user.avatar} name={status.user.name} /><span className="zhihu-account-name">{status.user.name}</span>
  </Link> : <Link className="zhihu-account" href="/me">{status ? "知乎登录" : "个人中心"}</Link>;
}
