"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Question } from "@/lib/reading/discovery";
import { ParticleField } from "./particle-field";

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

// 夜空登山地图：站点沿山路分布的坐标（百分比），与 .sky-trail 的 viewBox 100x52 对应
function stationPos(index: number, total: number) {
  const t = total <= 1 ? 0.5 : 0.08 + (0.84 * index) / (total - 1);
  const x = 7 + 86 * t;
  const y = 74 - 56 * (0.5 - 0.5 * Math.cos(Math.PI * t)) + (index % 2 === 0 ? 0 : 4);
  return { x, y };
}
const SKY_TRAIL = (() => {
  const points: string[] = [];
  for (let step = 0; step <= 24; step++) {
    const t = step / 24;
    const x = 7 + 86 * t;
    const y = 74 - 56 * (0.5 - 0.5 * Math.cos(Math.PI * t));
    points.push(`${x.toFixed(1)} ${(y * 0.52).toFixed(1)}`);
  }
  return `M ${points.join(" L ")}`;
})();

function RouteIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20">
      <path d="M6 5.5h5.2a3.8 3.8 0 0 1 3.8 3.8v5.2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="6" cy="5.5" r="2.2" fill="currentColor" />
      <circle cx="17" cy="16.5" r="2.2" fill="currentColor" />
    </svg>
  );
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
  const [visitedIds, setVisitedIds] = useState<Set<string>>(new Set());
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
      setVisitedIds(new Set(result.categories[0] ? [result.categories[0].id] : []));
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
    setVisitedIds(new Set());
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

          {assistantEnabled && stage === "entry" && (
            <div className="map-cta-row">
              <button className="map-cta" type="button" onClick={startReading}>
                <span className="map-cta-icon" aria-hidden="true"><RouteIcon /></span>
                生成我的阅读地图
              </button>
            </div>
          )}

          {assistantEnabled && stage !== "entry" && <section className={`agent-surface stage-${stage}`} aria-live="polite">
            <div className="agent-heading">
              <div className="agent-name">
                <span className="agent-icon"><RouteIcon /></span>
                <div><strong>问山阅读助手</strong></div>
              </div>
              {stage !== "map" && <span className="step-count">{stage === "summary" ? "已理解" : `${questionIndex + 1} / 3`}</span>}
            </div>

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
                        <span><strong>{option.label}</strong></span>
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
                <ul className="intent-bubbles" aria-label="已选关注点">
                  {history.length ? history.map((turn, index) => <li key={index}>{turn.answer}</li>) : <li>了解主要观点</li>}
                </ul>

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

                <div className="map-stage-layout">
                  <div className="map-stage-main">
                    <div className="sky-map" role="group" aria-label="登山阅读路线">
                      <ParticleField className="sky-particles" />
                      <svg className="sky-trail" viewBox="0 0 100 52" preserveAspectRatio="none" aria-hidden="true">
                        <path d={SKY_TRAIL} className="sky-path" />
                      </svg>
                      <div className="sky-progress" aria-hidden="true"><span>{visitedIds.size} / {categories.length} 站已探索</span></div>
                      <div className="sky-summit" aria-hidden="true">
                        <svg viewBox="0 0 40 26" fill="none">
                          <path d="M2 24 13 5l6.5 10L24 8l14 16z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                          <path d="M13 5l2.6 4-1.8 1.4L17 13" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
                        </svg>
                        <span>登顶 · 观点全貌</span>
                      </div>
                      <div className="sky-start">
                        <span>起点 · 当前问题</span>
                        <strong>{question.title}</strong>
                      </div>
                      {categories.map((category, index) => {
                        const pos = stationPos(index, categories.length);
                        const selected = selectedCategory?.id === category.id;
                        const visited = visitedIds.has(category.id);
                        return (
                          <button
                            key={category.id}
                            type="button"
                            draggable={false}
                            onDragStart={(event) => event.preventDefault()}
                            className={`sky-station${selected ? " current" : ""}${visited ? " visited" : ""}`}
                            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                            onClick={() => {
                              setSelectedCategoryId(category.id);
                              setSelectedPost(null);
                              setVisitedIds((previous) => new Set(previous).add(category.id));
                            }}
                            aria-pressed={selected}
                            aria-label={`第 ${index + 1} 站，${category.title}，包含 ${category.posts.length} 篇帖子`}
                          >
                            <span className="sky-dot"><b>{String(index + 1).padStart(2, "0")}</b></span>
                            <span className="sky-tag">
                              <strong>{category.title}</strong>
                              <small>{category.posts.length} 篇 · {category.phase}</small>
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    <div className="journey-bar" aria-label="阅读旅程">
                      {categories.map((category, index) => {
                        const selected = selectedCategory?.id === category.id;
                        const visited = visitedIds.has(category.id);
                        return (
                          <div key={category.id} className={`journey-stop${selected ? " current" : ""}${visited ? " past" : ""}`}>
                            <span className="journey-number">{String(index + 1).padStart(2, "0")}</span>
                            <span className="journey-label">{category.title}</span>
                            {index < categories.length - 1 && (
                              <span className={`journey-line${selected ? " current" : visited ? " past" : ""}`} aria-hidden="true" style={{ animationDelay: `${0.3 + index * 0.15}s` }} />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <aside className="map-stage-aside" aria-label="本分类事件列表">
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
                  </aside>
                </div>

                <p className="source-disclaimer">相关问题与文章 · 搜索摘要</p>
              </div>
            )}
          </section>}
        </section>

        <aside className="side-column" aria-label="阅读提示">
          {stage !== "map" && (
            <section className="answer-preview" aria-label="普通回答列表预览">
              <div className="answer-toolbar"><strong>这个问题下的回答</strong><span>摘要</span></div>
              {ordinaryLoading ? <p className="feed-notice" role="status">正在加载回答摘要…</p> : ordinaryError ? <p className="feed-notice" role="alert">{ordinaryError}</p> : ordinary.length === 0 ? <p className="feed-notice">暂未检索到这个问题的回答摘要，可前往知乎阅读。</p> :
                ordinary.map(item => <article className="ordinary-answer" key={item.url}><strong>{item.author}</strong><p>{item.excerpt}</p><div><span>{item.votes} 赞同</span><a href={item.url} target="_blank" rel="noreferrer">阅读完整回答</a></div></article>)}
              <a className="all-answers" href={question.url} target="_blank" rel="noreferrer">前往知乎查看全部回答</a>
            </section>
          )}
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
