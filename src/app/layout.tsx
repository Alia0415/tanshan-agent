import { ZhihuAccountProvider } from "@/components/zhihu-account";
import type { Metadata } from "next";
import "./globals.css";
import { MobileTabbar } from "@/components/mobile-tabbar";
import { BookmarkProvider } from "@/components/bookmarks";
import { ProductNav } from "@/components/product-nav";

export const metadata: Metadata = {
  title: "探山 Tanshan · 多问一句，答案更近一步",
  description:
    "从一个宽泛的问题开始，通过少量追问，找到真正与你有关的信息与建议。",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body><BookmarkProvider><ZhihuAccountProvider><ProductNav />{children}<MobileTabbar /></ZhihuAccountProvider></BookmarkProvider></body>
    </html>
  );
}
