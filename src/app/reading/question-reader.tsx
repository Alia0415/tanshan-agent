"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import type { Question } from "@/lib/reading/discovery";
import { BookmarkButton } from "@/components/bookmarks";
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
  focus?: string;
};

type MindMap = {
  thesis: string;
  summary: string;
  branches: Array<{ label: string; points: string[] }>;
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

const ORBIT_LAYOUTS = [
  [{x: 70, y: -112}, {x: 142, y: -62}, {x: 154, y: 12}, {x: 110, y: 82}, {x: 34, y: 112}],
  [{x: -138, y: -76}, {x: -18, y: -132}, {x: 130, y: -76}, {x: 145, y: 42}, {x: -86, y: 104}],
  [{x: -142, y: -54}, {x: -58, y: -118}, {x: 62, y: -108}, {x: 144, y: -28}, {x: 108, y: 76}],
  [{x: -158, y: -18}, {x: -146, y: 58}, {x: -88, y: 116}, {x: -8, y: 126}, {x: 36, y: 66}],
] as const;

function orbitPlacement(index: number, stationIndex: number) {
  const layout = ORBIT_LAYOUTS[Math.max(0, Math.min(ORBIT_LAYOUTS.length - 1, stationIndex))];
  const point = layout[index % layout.length];
  return {
    ...point,
    angle: Math.atan2(point.y, point.x) * (180 / Math.PI),
    length: Math.max(34, Math.hypot(point.x, point.y) - 58),
  };
}

function compactPostFocus(post: Post) {
  return post.focus?.trim() || post.title.trim() || "查看原文";
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
  const [stage, setStage] = useState<Stage>("entry");
  const [questionIndex, setQuestionIndex] = useState(0);
  const [clarifyQuestion, setClarifyQuestion] = useState<ClarifyQuestion | null>(null);
  const [history, setHistory] = useState<ReadingTurn[]>([]);
  const [selectedAnswer, setSelectedAnswer] = useState("");
  const [isClarifying, setIsClarifying] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [mindMapReplay, setMindMapReplay] = useState(0);
  const [postMindMaps, setPostMindMaps] = useState<Record<string, MindMap>>({});
  const [mindMapLoadingIds, setMindMapLoadingIds] = useState<Set<string>>(new Set());
  const [mindMapErrors, setMindMapErrors] = useState<Record<string, string>>({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [apiError, setApiError] = useState("");
  const [furthestStop, setFurthestStop] = useState(0);
  const [focusedCategoryId, setFocusedCategoryId] = useState("");
  const selectedCategory = categories.find((category) => category.id === selectedCategoryId) ?? categories[0];
  const selectedPostKey = selectedPost ? (selectedPost.contentId || selectedPost.url) : "";
  const selectedMindMap = selectedPostKey ? postMindMaps[selectedPostKey] : undefined;
  const focusedCategoryIndex = categories.findIndex((category) => category.id === focusedCategoryId);
  const focusedCategory = focusedCategoryIndex >= 0 ? categories[focusedCategoryIndex] : undefined;
  const focusedPosition = focusedCategory ? stationPos(focusedCategoryIndex, categories.length) : undefined;
  const routeProgress = categories.length > 1 ? 8 + (84 * furthestStop) / (categories.length - 1) : categories.length ? 8 : 0;

  useEffect(() => {
    if (!focusedCategoryId) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFocusedCategoryId("");
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [focusedCategoryId]);

  async function loadPostMindMap(post: Post, force = false) {
    const key = post.contentId || post.url;
    if (!force && (postMindMaps[key] || mindMapLoadingIds.has(key))) return;

    setMindMapLoadingIds((current) => new Set(current).add(key));
    setMindMapErrors((current) => {
      const next = {...current};
      delete next[key];
      return next;
    });
    try {
      const response = await fetch("/api/reading/mind-map", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({contentId: post.contentId, title: post.title, excerpt: post.excerpt}),
      });
      const result = await response.json();
      if (!response.ok || !result.mindMap) throw new Error(result.error || "思维导图暂时无法生成。");
      setPostMindMaps((current) => ({...current, [key]: result.mindMap}));
    } catch (error) {
      setMindMapErrors((current) => ({
        ...current,
        [key]: error instanceof Error ? error.message : "思维导图暂时无法生成。",
      }));
    } finally {
      setMindMapLoadingIds((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }

  function openPost(post: Post) {
    setSelectedPost(post);
    void loadPostMindMap(post);
  }

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
    const nextHistory = [...history.slice(0, questionIndex), { prompt: clarifyQuestion.prompt, answer: selectedAnswer }];
    setHistory(nextHistory);
    if (nextHistory.length >= 3) setStage("summary");
    else await loadClarifyingQuestion(nextHistory);
  }

  async function generateMap() {
    setIsGenerating(true);
    setApiError("");
    setSelectedPost(null);
    setFocusedCategoryId("");
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
      setFurthestStop(0);
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
    setApiError("");
    setIsGenerating(false);
    setFurthestStop(0);
    setFocusedCategoryId("");
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
            <span className="tanshan-word">探山</span>
          </Link>
          <Link className="back-home" href="/reading">← 返回首页，浏览更多问题</Link>
          <button className="quiet-button" type="button" disabled={isGenerating} onClick={resetSession}>重新开始阅读</button>
        </div>
      </header>

      <main id="top" className="page-grid">
        <section className="content-column" aria-label="知乎问题">
          <div className="question-block">
            <h1>{question.title}</h1>
            {question.summary && <p className="question-description">{question.summary}</p>}
            <div className="reading-handoffs"><Link href={"/roundtable?q=" + encodeURIComponent(question.title)}>带到圆桌讨论 →</Link><Link href={"/?q=" + encodeURIComponent(question.title)}>向 Agent 提问 →</Link></div>
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
              <strong className="agent-name">{stage === "map" ? "阅读地图" : "生成阅读地图"}</strong>
              {stage === "map"
                ? <button className="secondary-button" type="button" onClick={() => setStage("summary")}>调整关注点</button>
                : <span className="step-count">{stage === "summary" ? "已理解" : `${questionIndex + 1} / 3`}</span>}
            </div>

                {stage === "clarifying" && clarifyQuestion && (
                  <div className="clarifying-panel">
                <div className="progress-track" aria-hidden="true"><span style={{ width: `${((questionIndex + 1) / 3) * 100}%` }} /></div>
                <div className="agent-question"><h2>{clarifyQuestion.prompt}</h2><p>{clarifyQuestion.hint}</p></div>
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
                <div className="map-stage-layout">
                  <div className="map-stage-main">
                    <div className={`sky-map${focusedCategory ? " has-orbit" : ""}`} role="group" aria-label="登山阅读路线">
                      <ParticleField className="sky-particles" />
                      <svg className="sky-trail" viewBox="0 0 100 52" preserveAspectRatio="none" aria-hidden="true">
                        <path d={SKY_TRAIL} className="sky-path" pathLength="100" />
                        <path d={SKY_TRAIL} className="sky-path-progress" pathLength="100" style={{ strokeDashoffset: 100 - routeProgress }} />
                      </svg>
                      <div className="sky-progress" aria-hidden="true"><span>已走到第 {furthestStop + 1} 站</span></div>
                      {categories.map((category, index) => {
                        const pos = stationPos(index, categories.length);
                        const selected = selectedCategory?.id === category.id;
                        const visited = index <= furthestStop;
                        return (
                          <button
                            key={category.id}
                            type="button"
                            draggable={false}
                            onDragStart={(event) => event.preventDefault()}
                            className={`sky-station${selected ? " current" : ""}${visited ? " visited" : ""}${focusedCategoryId === category.id ? " orbit-center" : ""}`}
                            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                            onClick={() => {
                              setSelectedCategoryId(category.id);
                              setSelectedPost(null);
                              setFurthestStop((previous) => Math.max(previous, index));
                              setFocusedCategoryId(category.id);
                            }}
                            aria-pressed={selected}
                            aria-expanded={focusedCategoryId === category.id}
                            aria-label={`第 ${index + 1} 站，${category.phase}`}
                          >
                            <span className="sky-dot"><b>{String(index + 1).padStart(2, "0")}</b></span>
                            <span className="sky-tag">
                              <strong>{category.phase}</strong>
                            </span>
                          </button>
                        );
                      })}
                      {focusedCategory && focusedPosition && (
                        <>
                          <button className="orbit-dismiss" type="button" onClick={() => setFocusedCategoryId("")} aria-label="退出分类聚焦" />
                          <div
                            className="orbit-cluster"
                            key={focusedCategory.id}
                            style={{ left: `${focusedPosition.x}%`, top: `${focusedPosition.y}%` }}
                            aria-label={`${focusedCategory.title}的精选文章`}
                          >
                            <span className="orbit-halo" aria-hidden="true" />
                            {focusedCategory.posts.slice(0, 5).map((post, index) => {
                              const placement = orbitPlacement(index, focusedCategoryIndex);
                              const orbitStyle = {
                                "--orbit-x": `${placement.x}px`,
                                "--orbit-y": `${placement.y}px`,
                                "--orbit-angle": `${placement.angle}deg`,
                                "--orbit-length": `${placement.length}px`,
                                "--orbit-delay": `${index * 0.12}s`,
                                "--orbit-drift-delay": `${index * -1.7}s`,
                              } as CSSProperties;
                              return (
                                <div className="orbit-item" style={orbitStyle} key={post.contentId || post.url}>
                                  <span className="orbit-spoke" aria-hidden="true" />
                                  <span className="orbit-position">
                                    <a
                                      className="orbit-post"
                                      href={post.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      title={post.title}
                                    >
                                      <strong>{compactPostFocus(post)}</strong>
                                      <small>{post.voteUpCount} 赞同 · 知乎 ↗</small>
                                    </a>
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      )}
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
                              <button type="button" onClick={() => openPost(post)} aria-label={`查看帖子：${post.title}`}>
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
              <BookmarkButton corner post={selectedPost} /><h2 id="post-title">{selectedPost.title}</h2>
              <p className="post-byline">{selectedPost.author}{selectedPost.authorBadge ? ` · ${selectedPost.authorBadge}` : ""} · {selectedPost.readTime} · {selectedPost.voteUpCount} 赞同 · {selectedPost.commentCount} 评论</p>
              <section className="post-mind-map" aria-label="文章速读">
                <div className="mind-map-heading">
                  <div><span>30 秒看懂</span><h3>文章速读</h3></div>
                  {selectedMindMap && <button className="mind-map-replay" type="button" onClick={() => setMindMapReplay((value) => value + 1)}>重播动画</button>}
                </div>
                {selectedMindMap ? (
                  <div className="reading-flow" key={selectedPostKey + mindMapReplay}>
                    <div className="reading-flow-thesis">
                      <span>一句话结论</span>
                      <p>{selectedMindMap.thesis}</p>
                    </div>
                    <ol className="reading-flow-steps">
                      {selectedMindMap.branches.map((branch, index) => (
                        <li className="reading-flow-step" style={{ "--step": index } as CSSProperties} key={branch.label + index}>
                          <div className="reading-flow-marker" aria-hidden="true">{String(index + 1).padStart(2, "0")}</div>
                          <article>
                            <h4>{branch.label}</h4>
                            <ul>{branch.points.map((point) => <li key={point}>{point}</li>)}</ul>
                          </article>
                        </li>
                      ))}
                    </ol>
                    <small className="reading-flow-source">基于知乎搜索摘要生成 · 尚未获取全文</small>
                  </div>
                ) : mindMapLoadingIds.has(selectedPostKey) ? (
                  <div className="mind-map-loading" role="status">
                    <span>正在提炼文章结构与观点…</span>
                    <div>{[0, 1, 2, 3].map((item) => <i key={item} />)}</div>
                  </div>
                ) : (
                  <div className="mind-map-error" role="alert">
                    <p>{mindMapErrors[selectedPostKey] || "思维导图暂时无法生成。"}</p>
                    <button type="button" onClick={() => void loadPostMindMap(selectedPost, true)}>重新生成</button>
                  </div>
                )}
              </section>
              <section className="post-summary" aria-label="文章总结">
                <h3>文章总结</h3>
                <small>基于现有摘要，尚未获取全文</small>
                {selectedMindMap ? (
                  <p>{selectedMindMap.summary}</p>
                ) : mindMapLoadingIds.has(selectedPostKey) ? (
                  <p role="status">正在整理文章总结…</p>
                ) : (
                  <p>总结暂时无法生成，请点击上方“重新生成”重试。</p>
                )}
              </section>
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
