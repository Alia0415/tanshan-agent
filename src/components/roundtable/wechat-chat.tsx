"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Send, Sparkles } from "lucide-react";
import { displayClaim } from "@/lib/roundtable/brief";
import type { Roundtable } from "@/lib/roundtable/engine";
import type { PreviewSource } from "@/lib/roundtable/start-stream";

const phaseDividers: Record<string, string> = {
  opening: "圆桌开场",
  statement: "观点陈述",
  exchange: "观点交锋",
  summary: "主持人总结",
  user: "访客加入讨论",
};
function avatarClass(round: Roundtable, speaker: string, index: number) {
  if (speaker === "user") return "me";
  const role = round.roles.find((item) => item.id === speaker);
  if (!role) return "host";
  if (role.kind === "host") return "host";
  if (role.kind === "guest") return speaker.replace("guest-", "");
  return ["blue", "green", "amber"][index % 3];
}
export function WeChatChat({
  round,
  busy,
  error,
  playing,
  onSend,
  onTogglePlaying,
  onSummaries,
}: {
  round: Roundtable;
  busy: string;
  error: string;
  playing: boolean;
  onSend: (content: string) => void;
  onTogglePlaying: () => void;
  onSummaries?: (summaries: Record<string, string>) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [evidence, setEvidence] = useState<Record<string, string[]>>({});
  const [evidenceStatus, setEvidenceStatus] = useState<Record<string, "loading" | "error" | "ready">>({});
  const evidenceRequests = useRef(new Set<string>());
  const loadEvidence = async (id: string) => {
    const message = round.messages.find((item) => item.id === id);
    if (message?.brief?.evidencePoints?.length || message?.evidencePoints?.length || evidence[id] || evidenceRequests.current.has(id)) return;
    evidenceRequests.current.add(id);
    setEvidenceStatus((current) => ({ ...current, [id]: "loading" }));
    try {
      const response = await fetch("/api/roundtables/" + round.id + "/briefs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id], kind: "evidence" }),
        signal: AbortSignal.timeout(150_000),
      });
      if (!response.ok) throw new Error("Evidence summary failed");
      const result = await response.json() as Record<string, string[]>;
      if (!result[id]?.length) throw new Error("Missing evidence summary");
      setEvidence((current) => ({ ...current, ...result }));
      setEvidenceStatus((current) => ({ ...current, [id]: "ready" }));
    } catch {
      setEvidenceStatus((current) => ({ ...current, [id]: "error" }));
    } finally {
      evidenceRequests.current.delete(id);
    }
  };
  const [draft, setDraft] = useState("");
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [summaryError, setSummaryError] = useState(false);
  const requested = useRef(new Set<string>());
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const ids = round.messages.filter((message) =>
      message.speaker !== "user" && !displayClaim(message) &&
      !summaries[message.id] && !requested.current.has(message.id)
    ).map((message) => message.id);
    if (!ids.length) return;
    ids.forEach((id) => requested.current.add(id));
    void fetch("/api/roundtables/" + round.id + "/briefs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
      signal: AbortSignal.timeout(150_000),
    }).then(async (response) => {
      if (!response.ok) throw new Error("Summary failed");
      const result = await response.json() as Record<string, string>;
      setSummaries((current) => ({ ...current, ...result }));
      onSummaries?.(result);
    }).catch(() => setSummaryError(true));
  }, [round.id, round.messages, summaries, retry, onSummaries]);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [round.messages.length, busy]);
  const nameOf = (speaker: string) =>
    speaker === "user"
      ? "我"
      : (round.roles.find((role) => role.id === speaker)?.name ?? speaker);
  const submit = () => {
    const content = draft.trim();
    if (!content || busy) return;
    onSend(content);
    setDraft("");
  };
  const complete = round.scheduler.state === "complete";
  const speakerIndex = new Map<string, number>();
  round.roles.forEach((role, index) => speakerIndex.set(role.id, index));
  return (
    <div className="wechat-phone">
      <header className="wechat-header">
        <span className="wechat-header-title">
          圆桌讨论（{round.roles.filter((role) => role.kind !== "host").length + 1}）
        </span>
        <span className="wechat-header-sub">
          {round.messages.length} 条发言 · 引用可溯源
        </span>
      </header>
      <div className="wechat-body" ref={listRef}>
        {round.messages.map((message, index) => {
          const previous = round.messages[index - 1];
          const isUser = message.speaker === "user";
          const viewpoint = displayClaim(message, summaries);
          const points = message.brief?.evidencePoints || message.evidencePoints || evidence[message.id];
          const parent = message.replyTo
            ? round.messages.find((item) => item.id === message.replyTo)
            : undefined;
          return (
            <div key={message.id}>
              {previous?.phase !== message.phase && (
                <div className="wechat-divider">
                  {phaseDividers[message.phase] ?? message.phase}
                </div>
              )}
              <div className={"wechat-row" + (isUser ? " mine" : "")}>
                <div
                  className={
                    "wechat-avatar " +
                    avatarClass(round, message.speaker, speakerIndex.get(message.speaker) ?? 0)
                  }
                >
                  {isUser ? "我" : nameOf(message.speaker).slice(0, 1)}
                </div>
                <div className="wechat-col">
                  {!isUser && (
                    <div className="wechat-name">{nameOf(message.speaker)}</div>
                  )}
                  <div className="wechat-bubble">
                    {parent && (
                      <blockquote className="wechat-quote">
                        <b>{nameOf(parent.speaker)}：</b>
                        {parent.content.length > 48
                          ? parent.content.slice(0, 48) + "…"
                          : parent.content}
                      </blockquote>
                    )}
                    {!isUser ? (
                      <>
                        <div className="wechat-takeaway">
                          <p className="wechat-claim"><b>议题</b>{message.brief?.topic || round.question}</p>
                          <div className="wechat-viewpoint"><b>{message.phase === "opening" ? "开场" : "观点"}</b>{viewpoint ? <p>{viewpoint}</p> : summaryError ? <button type="button" className="wechat-expand" onClick={() => { requested.current.clear(); setSummaryError(false); setRetry((value) => value + 1); }}>重新生成观点</button> : <span role="status" aria-label="正在总结观点"><LoaderCircle size={14} className="spin" /></span>}</div>
                        </div>

                        {message.phase !== "opening" && <>
                        {message.citations.length === 0 && message.speaker !== "guest-counter" && <p className="wechat-evidence">本条发言暂无有效来源引用，观点尚待核实。</p>}
                        <button type="button" className="wechat-expand" aria-expanded={Boolean(expanded[message.id])} aria-controls={"message-" + message.id} onClick={() => { setExpanded((current) => ({ ...current, [message.id]: !current[message.id] })); if (!expanded[message.id]) void loadEvidence(message.id); }}>
                          {expanded[message.id] ? "收起论据" : "展开论据"}
                        </button>
                        <div id={"message-" + message.id} hidden={!expanded[message.id]}>
                          {points?.length ? <ol className="wechat-evidence-list" aria-label="论据要点">{points.map((point, pointIndex) => {
                            const colon = point.indexOf("：");
                            return <li key={pointIndex}>{colon > 0 && colon <= 10 ? <><b>{point.slice(0, colon)}</b><span>{point.slice(colon + 1)}</span></> : <span>{point}</span>}</li>;
                          })}</ol> : evidenceStatus[message.id] === "error" ? <p className="wechat-evidence">论据整理暂时失败。<button type="button" className="wechat-expand" onClick={() => void loadEvidence(message.id)}>重试</button></p> : <p className="wechat-evidence" role="status">正在整理分条论据…</p>}
                          <details className="wechat-original">
                            <summary>查看完整发言</summary>
                            {message.content.split(/\n+/).filter(Boolean).map((paragraph, paragraphIndex) => <p key={paragraphIndex}>{paragraph}</p>)}
                          </details>
                        </div>
                        </>}

                      </>
                    ) : <p>{message.content}</p>}
                    {message.citations.length > 0 && (
                      <div className="wechat-cites">
                        {message.citations.map((id) => {
                          const source = round.sources.find(
                            (item) => item.id === id,
                          );
                          return source ? (
                            <a
                              key={id}
                              href={source.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              [{id}] {source.title}
                            </a>
                          ) : null;
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {busy && <div className="wechat-typing">对方正在输入…</div>}
      </div>
      {error && (
        <p className="wechat-error" role="alert">
          {error}
        </p>
      )}
      <div className="wechat-toolbar">
        <button
          type="button"
          className="wechat-tool"
          onClick={onTogglePlaying}
          disabled={complete}
        >
          {playing ? "暂停自动讨论" : "自动讨论"}
        </button>
        <span className="wechat-state">
          {complete ? "已总结 · 仍可发言" : `第 ${round.messages.length} 条`}
        </span>
      </div>
      <footer className="wechat-input">
        <input
          value={draft}
          maxLength={300}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
          placeholder={busy ? "Agent 正在回应…" : "发言加入讨论…"}
          disabled={Boolean(busy)}
          aria-label="圆桌发言"
        />
        <button
          type="button"
          className="wechat-send"
          onClick={submit}
          disabled={Boolean(busy) || !draft.trim()}
          aria-label="发送"
        >
          <Send size={15} />
        </button>
      </footer>
      <p className="wechat-footnote">你的发言由最相关的 Agent 即时回应</p>
    </div>
  );
}
export function WeChatIntro({
  sources = [],
  question,
  setQuestion,
  busy,
  error,
  onStart,
}: {
  sources?: PreviewSource[];
  question: string;
  setQuestion: (value: string) => void;
  busy: string;
  error: string;
  onStart: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const loading = Boolean(busy);
  useEffect(() => {
    if (!loading) return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => { clearInterval(timer); setElapsed(0); };
  }, [loading]);
  return (
    <div className="wechat-phone">
      <header className="wechat-header">
        <span className="wechat-header-title">观点圆桌</span>
        <span className="wechat-header-sub">需要配置知乎凭证后开局</span>
      </header>
      <div className="wechat-body wechat-intro">
        <Sparkles size={30} className="wechat-intro-icon" />
        <h3>把一个问题交给几个立场</h3>
        <p>真实检索知乎帖子，生成不同立场的 Agent 开一场可插话的圆桌。</p>
        <textarea
          aria-label="本场讨论的问题"
          value={question}
          minLength={5}
          maxLength={200}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="例如：为什么很多人选择读博来延续学生身份？"
          disabled={Boolean(busy)}
        />
        <button
          type="button"
          className="wechat-send wechat-intro-go"
          onClick={onStart}
          disabled={Boolean(busy) || question.trim().length < 5}
        >
          {busy ? <><LoaderCircle size={16} className="spin" /> 正在准备</> : "组局"}
        </button>
        {busy && (
          <div className="wechat-start-progress">
            <div className="wechat-typing" role="status">{busy}</div>
            <div className="wechat-start-progress-track" role="progressbar" aria-label={busy}>
              <span className="wechat-start-progress-fill" />
            </div>
            <p className="wechat-start-progress-hint">已等待 {elapsed} 秒 · {sources.length ? "检索已完成，可先阅读下方资料" : "正在查找相关帖子"}</p>
            {elapsed >= 30 && <p className="wechat-start-progress-hint">{sources.length ? "模型还在整理观点与开场白，请稍候。" : "资料服务响应较慢，请稍候。"}无需重复提交。</p>}
          </div>
        )}
        {sources.length > 0 && <details className="wechat-start-sources" open>
          <summary>已找到的真实资料 · {sources.length} 条</summary>
          {sources.map((source) => <a key={source.id} href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a>)}
        </details>}
        {error && <p className="wechat-error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
