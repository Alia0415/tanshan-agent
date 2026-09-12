import type { Metadata } from "next";
import "./globals.css";
import { ProductNav } from "@/components/product-nav";

export const metadata: Metadata = {
  title: "问山 Wenshan · 多问一句，答案更近一步",
  description:
    "从一个宽泛的问题开始，通过少量追问，找到真正与你有关的信息与建议。",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body><ProductNav />{children}</body>
    </html>
  );
}
