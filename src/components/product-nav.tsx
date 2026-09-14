"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const products = [
  { href: "/bookmarks", label: "我的收藏" },
  { href: "/", label: "Agent 问答" },
  { href: "/reading", label: "阅读助手" },
  { href: "/roundtable", label: "观点圆桌" },
];

export function ProductNav() {
  const pathname = usePathname();
  const isAgentRoute = pathname === "/";

  return (
    <nav
      className={`product-nav${isAgentRoute ? " product-nav--agent" : ""}`}
      aria-label="功能导航"
    >
      {!isAgentRoute && (
        <Link className="product-brand" href="/">
          问山
        </Link>
      )}
      {products.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={
            (item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href))
              ? "page"
              : undefined
          }
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
