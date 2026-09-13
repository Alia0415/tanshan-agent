"use client";
import Link from "next/link";
import Image from "next/image";
import type { CSSProperties, FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import type { Question } from "@/lib/reading/discovery";

type AnswerSummary = { url: string; author: string; excerpt: string; votes: number };
type AnswerState = { loading: boolean; error: string; answers: AnswerSummary[] };
const EMPTY_ANSWERS: AnswerState = { loading: true, error: "", answers: [] };
const AUTO_ADVANCE_MS = 9000;
// 行高由 CSS 控制（--moon-line-h）：桌面 96px / 手机 64px，位移在 CSS 中按变量计算

export default function Home() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [query, setQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [view, setView] = useState("hot");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [answersByQuestion, setAnswersByQuestion] = useState<Record<string, AnswerState>>({});
  const fetchedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/reading/discovery?view=" + view + (searchTerm ? "&q=" + encodeURIComponent(searchTerm) : ""), {signal: controller.signal})
      .then(async res => { const body = await res.json(); if (!res.ok) throw new Error(body.error); return body; })
      .then(body => { setQuestions(body.questions); setIndex(0); })
      .catch(err => { if (!controller.signal.aborted) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [searchTerm, refresh, view]);
  function browse(term: string, nextView = "hot") {
    setError(""); setSearchTerm(term); setView(nextView); setRefresh(value => value + 1);
  }
  function submit(event: FormEvent) { event.preventDefault(); browse(query.trim()); }

  const safeIndex = questions.length ? index % questions.length : 0;
  const current = questions[safeIndex];
  const answerState = current ? (answersByQuestion[current.id] ?? EMPTY_ANSWERS) : null;
  const firstReply = answerState && !answerState.loading && answerState.answers.length ? answerState.answers[0] : null;

  // 进入页面即预热全部问题的回答缓存：3 路并发按序抓取，切题时秒出
  useEffect(() => {
    if (!questions.length) return;
    const ids = questions.map(item => item.id);
    let cursor = 0;
    let cancelled = false;
    const pull = (id: string) =>
      fetch("/api/reading/questions/" + id + "/answers")
        .then(async res => { const body = await res.json(); if (!res.ok) throw new Error(body.error || "暂时取不到回复"); return body; })
        .then(body => { if (!cancelled) setAnswersByQuestion(prev => ({ ...prev, [id]: { loading: false, error: "", answers: body.answers } })); })
        .catch(err => { if (!cancelled && err instanceof Error) setAnswersByQuestion(prev => ({ ...prev, [id]: { loading: false, error: err.message, answers: [] } })); })
        .finally(() => { if (!cancelled) worker(); });
    function worker() {
      if (cancelled) return;
      while (cursor < ids.length && fetchedRef.current.has(ids[cursor])) cursor++;
      if (cursor >= ids.length) return;
      const id = ids[cursor++];
      fetchedRef.current.add(id);
      void pull(id);
    }
    for (let i = 0; i < 3; i++) worker();
    return () => { cancelled = true; };
  }, [questions]);

  useEffect(() => {
    if (!playing || questions.length < 2) return;
    const timer = setInterval(() => setIndex(value => (value + 1) % questions.length), AUTO_ADVANCE_MS);
    return () => clearInterval(timer);
  }, [playing, questions.length]);

  return <div className="app-shell moon-page">
    <header className="topbar"><div className="topbar-inner">
      <Link className="brand" href="/reading"><span className="zhihu-word">知乎</span><span className="brand-divider"/><span className="wenshan-word">问山</span></Link>
      <form className="discovery-search" onSubmit={submit}><input aria-label="搜索知乎问题" placeholder="搜索你感兴趣的问题" value={query} maxLength={120} onChange={e => setQuery(e.target.value)}/><button type="submit">搜索</button></form>
      <span className="home-label">发现问题</span>
    </div></header>
    <main className="moon-stage" aria-label="热点问题唱片机">
      <section className="moon-lyrics" aria-label="热点问题列表">
        <div className="moon-filter">
          <button className={!searchTerm && view === "hot" ? "selected" : ""} onClick={() => {setQuery(""); browse("");}}>知乎热榜</button>
          <button className={!searchTerm && view === "history" ? "selected" : ""} onClick={() => {setQuery(""); browse("", "history");}}>曾经上榜</button>
          {searchTerm && <strong>搜索：{searchTerm}</strong>}
        </div>
        {loading ? <p className="moon-notice" role="status">正在加载真实知乎问题…</p>
          : error ? <div className="moon-notice" role="alert"><p>{error}</p><button onClick={() => browse(searchTerm, view)}>重试</button></div>
          : questions.length === 0 ? <p className="moon-notice">没有找到问题，换一个关键词试试。</p>
          : <div className="moon-lyrics-window">
              <div className="moon-lyrics-track" style={{ "--moon-idx": safeIndex } as CSSProperties}>
                {questions.map((item, i) => {
                  const distance = Math.abs(i - safeIndex);
                  return <button type="button" key={item.id}
                    className={`moon-line${i === safeIndex ? " current" : ""}`}
                    data-distance={distance}
                    onClick={() => setIndex(i)}
                    aria-current={i === safeIndex ? "step" : undefined}>
                    {item.title}
                  </button>;
                })}
              </div>
            </div>}
        <div className="moon-controls">
          <button type="button" aria-label="上一个问题" disabled={questions.length < 2} onClick={() => setIndex(value => (value - 1 + questions.length) % questions.length)}><SkipBack size={17} /></button>
          <button type="button" className="moon-toggle" aria-label={playing ? "暂停自动浏览" : "开始自动浏览"} onClick={() => setPlaying(value => !value)}>
            {playing ? <Pause size={19} /> : <Play size={19} />}
          </button>
          <button type="button" aria-label="下一个问题" disabled={questions.length < 2} onClick={() => setIndex(value => (value + 1) % questions.length)}><SkipForward size={17} /></button>
          <span className="moon-controls-label">{playing ? "自动换台中 · 每 9 秒" : "已暂停"}</span>
        </div>
      </section>

      <div className="moon-disc" aria-hidden="true">
        <div className={`moon-spin${playing ? "" : " paused"}`}>
          <Image className="moon-disc-img" src="/sea/disc-v2.jpg" alt="" width={1000} height={1000} priority />
        </div>
      </div>

      <section className="moon-answer" aria-label="当前问题的第一条回复">
        {current ? <>
          <span className="moon-answer-kicker">{searchTerm ? "知乎问题" : view === "history" ? "曾被问山记录在榜" : `热榜第 ${current.rank ?? "—"} 位`} · 知乎问题</span>
          <h2><Link prefetch={false} href={"/reading/question/" + current.id}>{current.title}</Link></h2>
          {answerState?.loading ? <p className="moon-answer-hint">正在取来第一条回复……</p>
            : answerState?.error ? <p className="moon-answer-hint moon-answer-error">{answerState.error}</p>
            : !firstReply ? <p className="moon-answer-hint">这个问题暂时没有取到回复，可以去原文页看看。</p>
            : <>
              <div className="moon-answer-body"><p>{firstReply.excerpt}</p></div>
              <div className="moon-answer-meta">—— {firstReply.author} · {firstReply.votes} 赞同</div>
            </>}
          <div className="moon-answer-actions">
            <Link prefetch={false} className="moon-answer-cta" href={"/reading/question/" + current.id}>进入问题，查看全部回答 →</Link>
            <a className="moon-answer-origin" href={current.url} target="_blank" rel="noreferrer">在知乎打开原文 ↗</a>
          </div>
        </> : <p className="moon-answer-hint">{loading ? "正在加载知乎热榜…" : "没有找到问题"}</p>}
        <small className="moon-answer-footnote">内容来自知乎 · 问山阅读</small>
      </section>
    </main>
  </div>;
}
