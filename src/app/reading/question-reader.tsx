"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Question } from "@/lib/reading/discovery";

type Stage = "entry" | "clarifying" | "summary" | "map";

type Post = {
  contentId: string;
  title: string;
  author: string;
  authorBadge: string;
  excerpt: string;
  url: string;
  contentType: string;
  voteUpCount: number;
  commentCount: number;
  editTime: number;
  readTime: string;
};

type Category = {
  id: string;
  title: string;
  summary: string;
  reason: string;
  views: string[];
  phase: string;
  posts: Post[];
};

type ReadingMapResult = {
  summary: string;
  searchHashIds: string[];
  categories: Category[];
};

type ClarifyQuestion = { prompt: string; hint: string; options: Array<{ id: string; label: string; detail: string }> };
type ReadingTurn = { prompt: string; answer: string };

function RouteIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20">
      <path d="M6 5.5h5.2a3.8 3.8 0 0 1 3.8 3.8v5.2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="6" cy="5.5" r="2.2" fill="currentColor" />
      <circle cx="17" cy="16.5" r="2.2" fill="currentColor" />
    </svg>
  );
}

function getIntentSummary(history: ReadingTurn[]) {
  if (!history.length) return "你希望先快速了解这个问题的主要观点，不限定具体身份和方向。";
  return history.map((turn) => `“${turn.answer}”`).join("，") + "。问山会据此安排阅读顺序，并保留其他重要观点。";
}

export default function QuestionReader({ question }: { question: Question }) {
  const assistantEnabled = Boolean(question.firstSeenHot);
  const [ordinary, setOrdinary] = useState<Array<{url: string; author: string; excerpt: string; votes: number}>>([]);
  const [ordinaryLoading, setOrdinaryLoading] = useState(true);
  const [ordinaryError, setOrdinaryError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/reading/questions/" + question.id + "/answers", {signal: controller.signal})
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); return data; })
      .then(data => setOrdinary(data.answers))
      .catch(error => { if (!controller.signal.aborted) setOrdinaryError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setOrdinaryLoading(false); });
    return () => controller.abort();
  }, [question.id]);
  const [stage, setStage] = useState<Stage>("entry");
  const [questionIndex, setQuestionIndex] = useState(0);
  const [clarifyQuestion, setClarifyQuestion] = useState<ClarifyQuestion | null>(null);
  const [history, setHistory] = useState<ReadingTurn[]>([]);
  const [selectedAnswer, setSelectedAnswer] = useState("");
  const [isClarifying, setIsClarifying] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [mapSummary, setMapSummary] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [apiError, setApiError] = useState("");
  const selectedCategory = categories.find((category) => category.id === selectedCategoryId) ?? categories[0];

  async function loadClarifyingQuestion(nextHistory: ReadingTurn[] = []) {
    setIsClarifying(true);
    setApiError("");
    try {
      const response = await fetch("/api/reading/clarify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ questionId: question.id, history: nextHistory }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "暂时无法生成追问，请重试。");
      setClarifyQuestion(result);
      setSelectedAnswer("");
      setQuestionIndex(nextHistory.length);
    } catch (error) { setApiError(error instanceof Error ? error.message : "暂时无法生成追问，请重试。"); }
    finally { setIsClarifying(false); }
  }

  function startReading() {
    setStage("clarifying");
    setHistory([]);
    void loadClarifyingQuestion([]);
  }

  async function continueClarifying() {
    if (!clarifyQuestion || !selectedAnswer) return;
    const nextHistory = [...history, { prompt: clarifyQuestion.prompt, answer: selectedAnswer }];
    setHistory(nextHistory);
    if (nextHistory.length >= 3) setStage("summary");
    else await loadClarifyingQuestion(nextHistory);
  }

  async function generateMap() {
    setIsGenerating(true);
    setApiError("");
    setSelectedPost(null);
    try {
      const response = await fetch("/api/reading/reading-map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId: question.id,
          history,
        }),
      });
      const result = await response.json() as ReadingMapResult & { error?: string };
      if (!response.ok) throw new Error(result.error || "真实内容整理失败，请重试。");
      setCategories(result.categories);
      setSelectedCategoryId(result.categories[0]?.id ?? "");
      setMapSummary(result.summary);
      setStage("map");
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "真实内容整理失败，请重试。");
    } finally {
      setIsGenerating(false);
    }
  }

  function resetSession() {
    setHistory([]);
    setClarifyQuestion(null);
    setSelectedAnswer("");
    setQuestionIndex(0);
    setCategories([]);
    setSelectedCategoryId("");
    setSelectedPost(null);
    setMapSummary("");
    setApiError("");
    setIsGenerating(false);
    setStage("entry");
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="brand" href="/reading" aria-label="返回問山首页">
            <span className="zhihu-mark">知</span>
            <span className="zhihu-word">知乎</span>
            <span className="brand-divider" />
            <span className="wenshan-word">问山</span>
          </Link>
          <Link className="back-home" href="/reading">← 返回首页，浏览更多问题</Link>
          <button className="quiet-button" type="button" disabled={isGenerating} onClick={resetSession}>重新开始阅读</button>
        </div>
      </header>

      <main id="top" className="page-grid">
        <section className="content-column" aria-label="知乎问题">
          <div className="question-block">
            <div className="topic-list"><span>知乎问题</span>{assistantEnabled && <span>已记录上榜 · 可用问山阅读</span>}</div>
            <h1>{question.title}</h1>
            {question.summary && <p className="question-description">{question.summary}</p>}
            <div className="reading-handoffs"><Link href={"/roundtable?q=" + encodeURIComponent(question.title)}>带到圆桌讨论 →</Link><Link href={"/?q=" + encodeURIComponent(question.title)}>向 Agent 提问 →</Link></div><a className="question-original" href={question.url} target="_blank" rel="noreferrer">在知乎查看完整问题与回答</a>
          </div>

          {assistantEnabled && <section className={`agent-surface stage-${stage}`} aria-live="polite">
            <div className="agent-heading">
              <div className="agent-name">
                <span className="agent-icon"><RouteIcon /></span>
                <div><strong>问山阅读助手</strong></div>
              </div>
              {stage !== "entry" && stage !== "map" && <span className="step-count">{stage === "summary" ? "已理解" : `${questionIndex + 1} / 3`}</span>}
            </div>

            {stage === "entry" && (
              <div className="entry-panel">
                <div><h2>回答很多，不知道先看什么？</h2></div>
                <button className="primary-button" type="button" onClick={startReading}>生成我的阅读地图</button>

              </div>
            )}

                {stage === "clarifying" && clarifyQuestion && (
                  <div className="clarifying-panel">
                <div className="progress-track" aria-hidden="true"><span style={{ width: `${((questionIndex + 1) / 3) * 100}%` }} /></div>
                <div className="agent-question"><span className="agent-avatar">山</span><div><h2>{clarifyQuestion.prompt}</h2><p>{clarifyQuestion.hint}</p></div></div>
                <div className="option-list" role="radiogroup" aria-label={clarifyQuestion.prompt}>
                  {clarifyQuestion.options.map((option) => {
                    const selected = selectedAnswer === option.label;
                    return (
                      <button key={option.id} className={`option-button${selected ? " selected" : ""}`} type="button" role="radio" aria-checked={selected} onClick={() => setSelectedAnswer(option.label)}>
                        <span className="radio-dot" aria-hidden="true" />
                        <span><strong>{option.label}</strong><small>{option.detail}</small></span>
                      </button>
                    );
                  })}
                </div>
                <div className="panel-actions">
                  <button className="text-button" type="button" onClick={() => setStage("summary")}>跳过，直接看观点全貌</button>
                  <button className="primary-button compact" type="button" disabled={!selectedAnswer || isClarifying} onClick={continueClarifying}>{questionIndex === 2 ? "完成" : isClarifying ? "正在生成…" : "继续"}</button>
                </div>
              </div>
            )}

            {stage === "summary" && (
              <div className="summary-panel">
                <span className="summary-kicker">我理解你更关心</span>
                <h2>{getIntentSummary(history)}</h2>

                <div className="panel-actions summary-actions">
                  <button className="secondary-button" type="button" disabled={isGenerating} onClick={() => { setStage("clarifying"); void loadClarifyingQuestion(history.slice(0, -1)); }}>修改关注点</button>
                  <button className="primary-button" type="button" disabled={isGenerating} onClick={generateMap}>{isGenerating ? "正在生成分类并检索…" : "生成阅读地图"}</button>
                </div>
                {apiError && <p className="api-error" role="alert">{apiError}</p>}
              </div>
            )}

            {stage === "map" && (
              <div className="map-panel">
                <div className="map-intro">
                  <div><h2>阅读地图</h2><p>{mapSummary}</p></div>
                  <button className="secondary-button" type="button" onClick={() => setStage("summary")}>调整关注点</button>
                </div>
                <div className="route-canvas">
                  <div className="route-start">
                    <span>起点 · 当前问题</span>
                    <strong>{question.title}</strong>
                  </div>
                  <span className="route-start-arrow" aria-hidden="true">↓</span>
                  <div className="route-path" role="list" aria-label="AI 推荐分类阅读顺序">
                    {categories.map((category, index) => {
                      return (
                        <div className="route-leg" key={category.id} role="listitem">
                          <button
                            className={`route-node${selectedCategory?.id === category.id ? " active" : ""}`}
                            type="button"
                            aria-pressed={selectedCategory?.id === category.id}
                            onClick={() => { setSelectedCategoryId(category.id); setSelectedPost(null); }}
                            aria-label={`第 ${index + 1} 类，${category.title}，包含 ${category.posts.length} 篇帖子`}
                          >
                            <span className="route-node-top">
                              <span className="route-number">{index + 1}</span>
                              <span className="route-verb">{index === 0 ? "先" : index === categories.length - 1 ? "最后" : "再"} · {category.phase}</span>
                              <span className="route-enter" aria-hidden="true">↓</span>
                            </span>
                            <strong className="route-title">{category.title}</strong>
                            <span className="route-summary">{category.summary}</span>
                            <span className="route-post">
                              <span className="route-post-label">本分类内容</span>
                              <b>{category.posts.length} 篇帖子</b>
                              <small>点击查看这一类的帖子</small>
                            </span>
                          </button>
                          {index < categories.length - 1 && (
                            <span className="route-arrow" aria-hidden="true">
                              <svg viewBox="0 0 34 18"><path d="M1 9h27" /><path d="m23 3 6 6-6 6" /></svg>
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                {selectedCategory && (
                  <section className="category-results" aria-labelledby="category-title">
                    <header className="category-results-header">
                      <div>
                        <span>路线第 {categories.findIndex((category) => category.id === selectedCategory.id) + 1} 类</span>
                        <h3 id="category-title">{selectedCategory.title}</h3>
                        <p>{selectedCategory.reason}</p>
                      </div>
                      <strong>{selectedCategory.posts.length}<small>篇</small></strong>
                    </header>
                    <div className="category-post-list" role="list">
                      {selectedCategory.posts.map((post, index) => (
                        <article className="category-post-row" key={post.contentId} role="listitem">
                          <button type="button" onClick={() => setSelectedPost(post)} aria-label={`查看帖子：${post.title}`}>
                            <span className="post-list-index">{String(index + 1).padStart(2, "0")}</span>
                            <span className="post-list-copy">
                              <strong>{post.title}</strong>
                              <span>{post.excerpt}</span>
                              <small>{post.author} · {post.voteUpCount} 赞同 · {post.commentCount} 评论 · {post.readTime}</small>
                            </span>
                            <span className="post-list-enter" aria-hidden="true">查看</span>
                          </button>
                        </article>
                      ))}
                    </div>
                  </section>
                )}

                <p className="source-disclaimer">相关问题与文章 · 搜索摘要</p>
              </div>
            )}
          </section>}

          {stage !== "map" && (
            <section className="answer-preview" aria-label="普通回答列表预览">
              <div className="answer-toolbar"><strong>这个问题下的回答</strong><span>搜索返回的摘要</span></div>
              {ordinaryLoading ? <p className="feed-notice" role="status">正在加载回答摘要…</p> : ordinaryError ? <p className="feed-notice" role="alert">{ordinaryError}</p> : ordinary.length === 0 ? <p className="feed-notice">暂未检索到这个问题的回答摘要，可前往知乎阅读。</p> :
                ordinary.map(item => <article className="ordinary-answer" key={item.url}><strong>{item.author}</strong><p>{item.excerpt}</p><div><span>{item.votes} 赞同</span><a href={item.url} target="_blank" rel="noreferrer">阅读完整回答</a></div></article>)}
              <a className="all-answers" href={question.url} target="_blank" rel="noreferrer">前往知乎查看全部回答</a>
            </section>
          )}
        </section>

        <aside className="side-column" aria-label="阅读提示">
          <div className="side-card"><h2>这次阅读</h2><dl><div><dt>问题类型</dt><dd>{assistantEnabled ? "已记录上榜" : "普通问题"}</dd></div><div><dt>整理方式</dt><dd>{assistantEnabled ? "按你的关注点" : "浏览回答"}</dd></div><div><dt>内容来源</dt><dd>知乎回答与文章</dd></div></dl></div>

        </aside>
      </main>

      {selectedPost && selectedCategory && (
        <div className="post-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedPost(null); }}>
          <article className="post-dialog" role="dialog" aria-modal="true" aria-labelledby="post-title">
            <header className="post-dialog-header">
              <div><span>路线第 {categories.findIndex((category) => category.id === selectedCategory.id) + 1} 类</span><strong>{selectedCategory.title}</strong></div>
              <button type="button" onClick={() => setSelectedPost(null)} aria-label="关闭帖子预览">×</button>
            </header>
            <div className="post-dialog-body">
              <span className="demo-badge">知乎{selectedPost.contentType === "Article" ? "文章" : "回答"}</span>
              <h2 id="post-title">{selectedPost.title}</h2>
              <p className="post-byline">{selectedPost.author}{selectedPost.authorBadge ? ` · ${selectedPost.authorBadge}` : ""} · {selectedPost.readTime} · {selectedPost.voteUpCount} 赞同 · {selectedPost.commentCount} 评论</p>
              <p className="post-lead">{selectedPost.excerpt}</p>
              <div className="post-context">
                <span>为什么先看这一类</span>
                <p>{selectedCategory.reason}</p>
              </div>
              <div className="post-takeaways">
                <h3>读这篇时，可以留意</h3>
                {selectedCategory.views.map((view, index) => <p key={view}><span>{index + 1}</span>{view}</p>)}
              </div>
            </div>
            <footer className="post-dialog-footer">

              <a href={selectedPost.url} target="_blank" rel="noreferrer">打开知乎原文 ↗</a>
            </footer>
          </article>
        </div>
      )}
    </div>
  );
}
