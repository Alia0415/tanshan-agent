"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import type { Question } from "@/lib/reading/discovery";
import { BookmarkButton } from "@/components/bookmarks";
import type { Synthesis } from "@/lib/reading/synthesis";

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
  synthesis: Synthesis;
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

export default function QuestionReader({ question }: { question: Question }) {
  const assistantEnabled = Boolean(question.firstSeenHot);
  const [stage, setStage] = useState<Stage>("entry");
  const [questionIndex, setQuestionIndex] = useState(0);
  const [clarifyQuestion, setClarifyQuestion] = useState<ClarifyQuestion | null>(null);
  const [history, setHistory] = useState<ReadingTurn[]>([]);
  const [selectedAnswer, setSelectedAnswer] = useState("");
  const [isClarifying, setIsClarifying] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [synthesis, setSynthesis] = useState<Synthesis | null>(null);
  const [overallSummary, setOverallSummary] = useState("");
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [mindMapReplay, setMindMapReplay] = useState(0);
  const [postMindMaps, setPostMindMaps] = useState<Record<string, MindMap>>({});
  const [mindMapLoadingIds, setMindMapLoadingIds] = useState<Set<string>>(new Set());
  const [mindMapErrors, setMindMapErrors] = useState<Record<string, string>>({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationSeconds, setGenerationSeconds] = useState(0);
  const generationRequest = useRef<AbortController | null>(null);
  const [apiError, setApiError] = useState("");
  const selectedPostKey = selectedPost ? (selectedPost.contentId || selectedPost.url) : "";
  const selectedMindMap = selectedPostKey ? postMindMaps[selectedPostKey] : undefined;
  useEffect(() => () => generationRequest.current?.abort(), []);

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
    if (generationRequest.current) return;
    const controller = new AbortController();
    generationRequest.current = controller;
    const startedAt = Date.now();
    setGenerationSeconds(0);
    const timer = window.setInterval(() => setGenerationSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    const timeout = window.setTimeout(() => controller.abort("timeout"), 600000);
    setIsGenerating(true);
    setApiError("");
    setSelectedPost(null);
    try {
      const response = await fetch("/api/reading/reading-map", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId: question.id,
          history,
        }),
      });
      const result = await response.json() as ReadingMapResult & { error?: string };
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(result.error || "真实内容整理失败，请重试。");
      setCategories(result.categories);
      setSynthesis(result.synthesis);
      setOverallSummary(result.summary);
      setStage("map");
    } catch (error) {
      setApiError(controller.signal.aborted
        ? controller.signal.reason === "timeout" ? "等待时间过长，请点击重新生成。你的关注点已保留。" : "已停止等待，你可以重新生成。"
        : error instanceof Error ? error.message : "真实内容整理失败，请重试。");
    } finally {
      window.clearInterval(timer);
      window.clearTimeout(timeout);
      generationRequest.current = null;
      setIsGenerating(false);
    }
  }

  function resetSession() {
    setHistory([]);
    setClarifyQuestion(null);
    setSelectedAnswer("");
    setQuestionIndex(0);
    setCategories([]);
    setSynthesis(null);
    setOverallSummary("");
    setSelectedPost(null);
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
            <div className="reading-handoffs"><Link href={"/roundtable?q=" + encodeURIComponent(question.title)}>带到圆桌讨论 →</Link></div>
          </div>

          {assistantEnabled && stage === "entry" && (
            <div className="map-cta-row">
              <button className="map-cta" type="button" onClick={startReading}>
                <span className="map-cta-icon" aria-hidden="true"><RouteIcon /></span>
                生成综合解读
              </button>
            </div>
          )}

          {assistantEnabled && stage !== "entry" && <section className={`agent-surface stage-${stage}`} aria-live="polite">
            <div className="agent-heading">
              <strong className="agent-name">{stage === "map" ? "综合解读" : "生成综合解读"}</strong>
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

                {isGenerating && (
                  <div className="map-generation" aria-busy="true">
                    <div className="map-generation-heading">
                      <strong role="status">正在为你生成综合解读</strong>
                      <span aria-live="off">已等待 {generationSeconds} 秒</span>
                    </div>
                    <div className="map-generation-track" role="progressbar" aria-label="综合解读生成中"><span /></div>
                    <p>{generationSeconds >= 60 ? "本次整理耗时较长，仍在等待结果。你可以继续等待，也可以停止等待后重试。" : "将根据你的关注点检索知乎内容，综合事实、逻辑、影响与分歧，完成后自动展示综合结论。"}</p>
                    <button className="text-button" type="button" onClick={() => generationRequest.current?.abort()}>停止等待</button>
                  </div>
                )}
                <div className="panel-actions summary-actions">
                  <button className="secondary-button" type="button" disabled={isGenerating} onClick={() => { setStage("clarifying"); void loadClarifyingQuestion(history.slice(0, -1)); }}>修改关注点</button>
                  <button className="primary-button" type="button" disabled={isGenerating} onClick={generateMap}>{isGenerating ? "正在生成…" : apiError ? "重新生成综合解读" : "生成综合解读"}</button>
                </div>
                {apiError && <p className="api-error" role="alert">{apiError}</p>}
              </div>
            )}

            {stage === "map" && (
              <div className="synthesis-panel">
                <div className="synthesis-lead"><span>综合解读</span><h2>这些内容，放在一起怎么看？</h2><p>{overallSummary}</p><small>基于知乎搜索摘要生成，尚未获取全文；推断与待核实信息见各项说明。</small></div>
                <div className="synthesis-grid">
                  {synthesis?.sections.map((section) => (
                    <section className={`synthesis-section synthesis-${section.key}`} key={section.key}>
                      <h3>{section.title}</h3>
                      {section.points.length ? section.points.map((point, index) => (
                        <div className="synthesis-point" key={index}>
                          <span className="synthesis-status">{point.kind}</span><p>{point.text}</p>
                          <div className="synthesis-sources">{point.sources.map((source) => <a key={source.ref} href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a>)}</div>
                        </div>
                      )) : <p className="synthesis-empty">现有材料不足，暂不作判断。</p>}
                    </section>
                  ))}
                </div>
                <section className="synthesis-articles" aria-label="相关文章">
                  <h3>相关文章</h3><p>需要更多细节时，展开查看摘要或打开原文。</p>
                  {categories.map((category) => <details key={category.id}>
                    <summary>{category.title}<span>{category.posts.length} 篇</span></summary>
                    {category.posts.length ? category.posts.map((post) => <article className="synthesis-article" key={post.contentId || post.url}>
                      <h4><a href={post.url} target="_blank" rel="noreferrer">{post.title} ↗</a></h4>
                      <p>{post.excerpt}</p><div><small>{post.author} · {post.voteUpCount} 赞同</small><button type="button" className="text-button" onClick={() => openPost(post)}>单篇解读</button></div>
                    </article>) : <p>暂未找到相关材料。</p>}
                  </details>)}
                </section>
              </div>
            )}
          </section>}
        </section>

      </main>

      {selectedPost && (
        <div className="post-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedPost(null); }}>
          <article className="post-dialog" role="dialog" aria-modal="true" aria-labelledby="post-title">
            <header className="post-dialog-header">
              <div><strong>单篇解读</strong></div>
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
