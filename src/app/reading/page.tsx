"use client";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import type { Question } from "@/lib/reading/discovery";

export default function Home() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [query, setQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [view, setView] = useState("hot");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/reading/discovery?view=" + view + (searchTerm ? "&q=" + encodeURIComponent(searchTerm) : ""), {signal: controller.signal})
      .then(async res => { const body = await res.json(); if (!res.ok) throw new Error(body.error); return body; })
      .then(body => setQuestions(body.questions))
      .catch(error => { if (!controller.signal.aborted) setError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [searchTerm, refresh, view]);
  function browse(term: string, nextView = "hot") {
    setLoading(true); setError(""); setSearchTerm(term); setView(nextView); setRefresh(value => value + 1);
  }
  function submit(event: FormEvent) { event.preventDefault(); browse(query.trim()); }
  return <div className="app-shell">
    <header className="topbar"><div className="topbar-inner">
      <Link className="brand" href="/reading"><span className="zhihu-word">知乎</span><span className="brand-divider"/><span className="wenshan-word">问山</span></Link>
      <form className="discovery-search" onSubmit={submit}><input aria-label="搜索知乎问题" placeholder="搜索你感兴趣的问题" value={query} maxLength={120} onChange={e => setQuery(e.target.value)}/><button type="submit">搜索</button></form>
      <span className="home-label">发现问题</span>
    </div></header>
    <main className="feed-page">
      <div className="feed-intro"><span>今天，大家在讨论什么</span><h1>从一个好问题，开始阅读。</h1><p>浏览问题，进入回答区。热门讨论里，问山帮你找到值得先读的方向。</p></div>
      <div className="feed-layout"><section className="question-feed" aria-label="问题列表">
        <div className="feed-toolbar"><button className={!searchTerm && view === "hot" ? "selected" : ""} onClick={() => {setQuery(""); browse("");}}>知乎热榜</button><button className={!searchTerm && view === "history" ? "selected" : ""} onClick={() => {setQuery(""); browse("", "history");}}>曾经上榜</button>{searchTerm && <strong>搜索：{searchTerm}</strong>}</div>
        {loading ? <p className="feed-notice" role="status">正在加载真实知乎问题…</p> : error ? <div className="feed-notice" role="alert"><p>{error}</p><button className="secondary-button" onClick={() => browse(searchTerm, view)}>重试</button></div> : questions.length === 0 ? <p className="feed-notice">没有找到问题，换一个关键词试试。</p> :
          questions.map(item => <article className="feed-question" key={item.id}>
            <div className="feed-question-meta"><span>{searchTerm ? "知乎问题" : view === "history" ? "曾被问山记录在榜" : "热榜第 " + item.rank + " 位"}</span>{item.firstSeenHot && <span className="assistant-badge">可用问山阅读</span>}</div>
            <h2><Link prefetch={false} href={"/reading/question/" + item.id}>{item.title}</Link></h2>
            {item.summary && <p>{item.summary}</p>}
            <Link prefetch={false} className="question-entry" href={"/reading/question/" + item.id}>进入问题，查看回答 <span aria-hidden="true">→</span></Link>
          </article>)}
      </section><aside className="discovery-note"><span className="agent-avatar">山</span><h2>热门问题，慢慢读懂</h2><p>进入问题后，先告诉问山你关注什么，再沿着分类地图阅读。</p><p>已记录上榜的问题会保留阅读助手入口。</p><small>这里是问山独立演示站，内容来自知乎。</small></aside></div>
    </main>
  </div>;
}
