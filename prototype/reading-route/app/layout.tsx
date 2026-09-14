import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "探山｜你的知乎阅读地图",
  description: "先理解你的关注点，再带你找到值得阅读的知乎观点。",
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
