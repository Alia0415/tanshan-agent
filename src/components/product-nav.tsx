"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const products = [
  { href: "/", label: "Agent 问答" },
  { href: "/reading", label: "阅读助手" },
  { href: "/roundtable", label: "观点圆桌" },
];

export function ProductNav() {
  const pathname = usePathname();
  const isAgentRoute = pathname === "/";
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!isAgentRoute) return;

    const nav = navRef.current;
    let scroller: HTMLElement | null = null;
    let attachFrame = 0;

    const updateAppearance = () => {
      nav?.classList.toggle(
        "product-nav--scrolled",
        (scroller?.scrollTop ?? 0) > 16,
      );
    };

    const attach = () => {
      scroller = document.querySelector<HTMLElement>(".agent-main-scroll");
      if (!scroller) {
        attachFrame = window.requestAnimationFrame(attach);
        return;
      }

      updateAppearance();
      scroller.addEventListener("scroll", updateAppearance, { passive: true });
    };

    attach();
    return () => {
      window.cancelAnimationFrame(attachFrame);
      scroller?.removeEventListener("scroll", updateAppearance);
      nav?.classList.remove("product-nav--scrolled");
    };
  }, [isAgentRoute]);

  return (
    <nav
      ref={navRef}
      className={`product-nav${isAgentRoute ? " product-nav--agent" : ""}`}
      aria-label="功能导航"
    >
      {!isAgentRoute && (
        <Link className="product-brand" href="/">
          探山
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
