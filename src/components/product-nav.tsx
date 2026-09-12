"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
export function ProductNav() {
 const pathname = usePathname();
 return <nav className="product-nav" aria-label="功能导航"><Link className="product-brand" href="/">问山</Link>{[{href:"/",label:"Agent 问答"},{href:"/reading",label:"阅读助手"},{href:"/roundtable",label:"观点圆桌"}].map(item => <Link key={item.href} href={item.href} aria-current={(item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)) ? "page" : undefined}>{item.label}</Link>)}</nav>;
}
