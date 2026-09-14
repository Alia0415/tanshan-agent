import { notFound } from "next/navigation";
import { Mountain } from "lucide-react";
import Link from "next/link";
import { SearchProgress } from "@/components/search-progress";

export default async function LoadingPreview({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const { state } = await searchParams;
  const disconnected = state === "offline";
  const searching = state !== "generating";
  return (
    <main style={{ maxWidth: 760, margin: "60px auto", padding: "0 20px" }}>
      <nav aria-label="预览状态" style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 24, fontSize: 13 }}>
        <Link href="/loading-preview">寻找资料</Link>
        <Link href="/loading-preview?state=generating">整理答案</Link>
        <Link href="/loading-preview?state=offline">连接中断</Link>
        <Link href="/">返回首页</Link>
      </nav>
      <section className="panel progress-panel">
        <span className="progress-orbit"><Mountain size={31} /></span>
        <h2>{disconnected ? "连接暂时中断" : searching ? "正在寻找与你相关的内容" : "正在整理答案中的线索"}</h2>
        <p>{disconnected ? "已保留本次请求，重新连接只会检查状态。" : "好的答案需要一点时间，我们正在核对资料与引用。"}</p>
        <div className="tags"><span className="tag">比较与选择</span></div>
        <SearchProgress searching={searching} disconnected={disconnected} />
        {disconnected && <Link className="primary" href="/loading-preview">重新连接</Link>}
      </section>
      <p style={{ textAlign: "center", color: "#64748b", fontSize: 12, marginTop: 20 }}>加载效果预览 · 不会发起检索请求</p>
    </main>
  );
}
