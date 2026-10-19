"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, MessagesSquare, Mountain, UserRound } from "lucide-react";
import { useDemoMode } from "./demo-mode";

// 手机端底部导航：问答 / 阅读助手 / 观点圆桌 / 我的知乎。
// 仅在窄屏显示（样式见 globals.css），当前页高亮，跳转逻辑一目了然。

const TABS = [
  { href: "/", label: "问答", icon: Mountain, match: (path: string) => path === "/" },
  {
    href: "/reading",
    label: "阅读",
    icon: BookOpen,
    match: (path: string) => path.startsWith("/reading"),
  },
  {
    href: "/roundtable",
    label: "圆桌",
    icon: MessagesSquare,
    match: (path: string) => path.startsWith("/roundtable"),
  },
  { href: "/me", label: "我的", icon: UserRound, match: (path: string) => path.startsWith("/me") },
];

export function MobileTabbar() {
  const demo = useDemoMode();
  const pathname = usePathname() || "/";
  const tabs = TABS.map(tab => demo.enabled && tab.href === "/me"
    ? { ...tab, href: "/demo", label: "体验说明", match: (path: string) => path === "/demo" }
    : tab);
  return (
    <nav className="mobile-tabbar" aria-label="主导航">
      {tabs.map((tab) => {
        const active = tab.match(pathname);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={active ? "on" : ""}
            aria-current={active ? "page" : undefined}
          >
            <tab.icon size={20} aria-hidden="true" />
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
