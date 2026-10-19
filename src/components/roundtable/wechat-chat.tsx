"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Pause, Play, Send, Sparkles } from "lucide-react";
import { displayClaim } from "@/lib/roundtable/brief";
import type { Roundtable, RoundtableSummary } from "@/lib/roundtable/engine";
import type { PreviewSource } from "@/lib/roundtable/start-stream";
import { useDemoMode } from "@/components/demo-mode";
import { DEMO_TOPICS } from "@/lib/reading/demo";

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
  onRoundUpdated,
  unavailable = false,
  onRestart,
}: {
  round: Roundtable;
  busy: string;
  error: string;
  playing: boolean;
  onSend: (content: string) => void;
  onTogglePlaying: () => void;
  onSummaries?: (summaries: Record<string, string>) => void;
  onRoundUpdated?: (round: Roundtable) => void;
  unavailable?: boolean;
  onRestart?: () => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [evidence, setEvidence] = useState<Record<string, string[]>>({});
  const [evidenceStatus, setEvidenceStatus] = useState<Record<string, "loading" | "error" | "ready">>({});
  const evidenceRequests = useRef(new Set<string>());
  const [draft, setDraft] = useState("");
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [summaryErrors, setSummaryErrors] = useState<Record<string, boolean>>({});
  const requested = useRef(new Set<string>());
  const [retry, setRetry] = useState(0);
  const [autoStarted, setAutoStarted] = useState(round.scheduler.turn > 0);
  const requestScope = useRef<{ id: string; controller: AbortController } | null>(null);
  useEffect(() => {
    const scope = { id: round.id, controller: new AbortController() };
    requestScope.current = scope;
    const claims = requested.current;
    const proofs = evidenceRequests.current;
    return () => {
      scope.controller.abort();
      claims.clear();
      proofs.clear();
      if (requestScope.current === scope) requestScope.current = null;
    };
  }, [round.id]);
  const loadEvidence = async (id: string) => {
    const scope = requestScope.current;
    if (!scope || scope.id !== round.id || unavailable) return;
    const current = () => requestScope.current === scope && !scope.controller.signal.aborted;
    const message = round.messages.find((item) => item.id === id);
    if (message?.brief?.evidencePoints?.length || message?.evidencePoints?.length || evidence[id] || evidenceRequests.current.has(id)) return;
    evidenceRequests.current.add(id);
    setEvidenceStatus((current) => ({ ...current, [id]: "loading" }));
    try {
      const response = await fetch("/api/roundtables/" + round.id + "/briefs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id], kind: "evidence", checkpoint: round.checkpoint, includeRound: true }),
        signal: AbortSignal.any([scope.controller.signal, AbortSignal.timeout(150_000)]),
      });
      if (!response.ok) throw new Error("Evidence summary failed");
      const data = await response.json() as Record<string, string[]> | { summaries: Record<string, string[]>; roundtable: Roundtable };
      if (!current()) return;
      const updated = "roundtable" in data && !Array.isArray(data.roundtable) ? data.roundtable : undefined;
      const result = updated ? (data as { summaries: Record<string, string[]> }).summaries : data as Record<string, string[]>;
      if (updated && updated.id !== round.id) throw new Error("Mismatched roundtable");
      if (!result[id]?.length) throw new Error("Missing evidence summary");
      setEvidence((current) => ({ ...current, ...result }));
      setEvidenceStatus((current) => ({ ...current, [id]: "ready" }));
      if (updated) onRoundUpdated?.(updated);
    } catch {
      if (current()) setEvidenceStatus((current) => ({ ...current, [id]: "error" }));
    } finally {
      if (current()) evidenceRequests.current.delete(id);
    }
  };
  useEffect(() => {
    const scope = requestScope.current;
    if (!scope || scope.id !== round.id || unavailable) return;
    const current = () => requestScope.current === scope && !scope.controller.signal.aborted;
    const ids = round.messages.filter((message) =>
      message.speaker !== "user" && !displayClaim(message) &&
      !summaries[message.id] && !requested.current.has(message.id)
    ).map((message) => message.id);
    if (!ids.length) return;
    ids.forEach((id) => requested.current.add(id));
    void fetch("/api/roundtables/" + round.id + "/briefs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, checkpoint: round.checkpoint, includeRound: true }),
      signal: AbortSignal.any([scope.controller.signal, AbortSignal.timeout(150_000)]),
    }).then(async (response) => {
      if (!response.ok) throw new Error("Summary failed");
      const data = await response.json() as Record<string, string> | { summaries: Record<string, string>; roundtable: Roundtable };
      if (!current()) return;
      const updated = "roundtable" in data && typeof data.roundtable !== "string" ? data.roundtable : undefined;
      const received = updated ? (data as { summaries: Record<string, string> }).summaries : data as Record<string, string>;
      if (updated && updated.id !== round.id) throw new Error("Mismatched roundtable");
      const result = Object.fromEntries(ids.filter((id) => typeof received[id] === "string" && received[id].trim()).map((id) => [id, received[id].trim()]));
      setSummaries((current) => ({ ...current, ...result }));
      setSummaryErrors((current) => ({ ...current, ...Object.fromEntries(ids.map((id) => [id, !result[id]])) }));
      onSummaries?.(result);
      if (updated) onRoundUpdated?.(updated);
    }).catch(() => {
      if (current()) setSummaryErrors((current) => ({ ...current, ...Object.fromEntries(ids.map((id) => [id, true])) }));
    });
  }, [round.id, round.messages, round.checkpoint, summaries, retry, onSummaries, onRoundUpdated, unavailable]);
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
    if (!content || busy || unavailable) return;
    onSend(content);
    setDraft("");
  };
  const complete = round.scheduler.state === "complete";
  const showStartGuide = !autoStarted && !playing && !complete;
  const togglePlaying = () => {
    if (!playing) setAutoStarted(true);
    onTogglePlaying();
  };
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
                          <div className="wechat-viewpoint">
                            <b>{message.phase === "opening" ? "开场" : "观点"}</b>
                            {viewpoint ? <p>{viewpoint}</p> : unavailable || summaryErrors[message.id] ? <>
                              <p className="wechat-summary-missing">观点暂未整理，可展开论据查看完整发言。</p>
                              {!unavailable && <button type="button" className="wechat-expand" onClick={() => {
                                requested.current.delete(message.id);
                                setSummaryErrors((current) => ({ ...current, [message.id]: false }));
                                setRetry((value) => value + 1);
                              }}>重新生成观点</button>}
                            </> : <span role="status" aria-label="正在总结观点"><LoaderCircle size={14} className="spin" /></span>}
                          </div>
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
                          })}</ol> : unavailable || evidenceStatus[message.id] === "error" ? <p className="wechat-evidence">论据暂未整理，可查看完整发言。{!unavailable && <button type="button" className="wechat-expand" onClick={() => void loadEvidence(message.id)}>重试</button>}</p> : <p className="wechat-evidence" role="status">正在整理分条论据…</p>}
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
      {unavailable ? <div className="wechat-recovery">
        <p>本场内容仍可阅读，可重新发起讨论。</p>
        {onRestart && <button type="button" className="wechat-tool" onClick={onRestart} disabled={Boolean(busy)}>重新发起</button>}
      </div> : <p id="roundtable-play-guide" className={"wechat-play-guide" + (showStartGuide ? " ready" : "")} role="status">
        {complete ? "讨论已总结，你仍可在下方发言追问。"
          : playing ? "自动讨论中，可随时暂停或在下方插话。"
          : showStartGuide ? <>开场已就绪。点击<strong>自动讨论</strong>，让嘉宾依次发言；可随时暂停或插话。</>
          : "自动讨论已暂停，点击继续，也可在下方插话。"}
      </p>}
      <div className="wechat-toolbar">
        <button
          type="button"
          className={"wechat-tool wechat-play" + (showStartGuide && !unavailable ? " ready" : "")}
          onClick={togglePlaying}
          disabled={unavailable || complete || (Boolean(busy) && !playing)}
          aria-pressed={playing}
          aria-describedby={unavailable ? undefined : "roundtable-play-guide"}
        >
          {playing ? <Pause size={13} aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}
          {complete ? "讨论已结束" : playing ? "暂停讨论" : autoStarted ? "继续自动讨论" : "自动讨论"}
        </button>
        <span className="wechat-state">
          {unavailable ? "本场暂不可继续" : complete ? "已总结 · 仍可发言" : playing ? "自动讨论中" : autoStarted ? "已暂停" : "等待开始"}
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
          placeholder={unavailable ? "请重新发起讨论" : busy ? "Agent 正在回应，可先输入…" : "发言加入讨论…"}
          disabled={unavailable}
          aria-label="圆桌发言"
        />
        <button
          type="button"
          className="wechat-send"
          onClick={submit}
          disabled={Boolean(busy) || unavailable || !draft.trim()}
          aria-label="发送"
        >
          <Send size={15} />
        </button>
      </footer>
      <p className="wechat-footnote">你的发言由最相关的 Agent 即时回应</p>
    </div>
  );
}
// Debatable, Zhihu-flavoured openers; kept short so every chip stays two lines.
export const EXAMPLE_QUESTIONS = [
  "为什么很多人选择读博来延续学生身份？",
  "年轻人该留在大城市还是回家乡？",
  "AI 会取代程序员吗？",
  "提前还房贷真的划算吗？",
];
export function WeChatIntro({
  sources = [],
  recent = [],
  question,
  setQuestion,
  busy,
  error,
  onStart,
  onResume,
}: {
  sources?: PreviewSource[];
  recent?: RoundtableSummary[];
  question: string;
  setQuestion: (value: string) => void;
  busy: string;
  error: string;
  onStart: () => void;
  onResume?: (id: string) => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const demo = useDemoMode();
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
        <span className="wechat-header-sub">{demo.enabled ? (demo.aiEnabled ? "DeepSeek × 原创样例" : "原创样例 × 本地脚本") : "需要配置知乎凭证后开局"}</span>
      </header>
      <div className="wechat-body wechat-intro">
        <Sparkles size={30} className="wechat-intro-icon" />
        <h3>
          <span className="copy-desktop">把一个问题交给几个立场</span>
          <span className="copy-mobile">跟不同观点的代表谈谈</span>
        </h3>
        <p>{demo.enabled ? "围绕预置原创样例，让不同立场展开可插话的讨论。材料与角色不代表真实知乎用户。" : "真实检索知乎帖子，生成不同立场的 Agent 开一场可插话的圆桌。"}</p>
        <div className="wechat-examples" role="group" aria-label="示例问题">
          <p className="wechat-examples-title">试试这些问题</p>
          <div className="wechat-examples-grid">
            {(demo.enabled ? DEMO_TOPICS.map(topic => topic.title) : EXAMPLE_QUESTIONS).map((item) => (
              <button
                key={item}
                type="button"
                className="wechat-example"
                aria-pressed={question.trim() === item}
                disabled={Boolean(busy)}
                onClick={() => setQuestion(item)}
              >
                <span>{item}</span>
              </button>
            ))}
          </div>
        </div>
        <textarea
          aria-label="本场讨论的问题"
          value={question}
          minLength={5}
          maxLength={200}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="也可以直接输入你想讨论的问题…"
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
            <p className="wechat-start-progress-hint">已等待 {elapsed} 秒 · {demo.enabled ? "正在根据预置样例组织讨论" : sources.length ? "检索已完成，可先阅读下方资料" : "正在查找相关帖子"}</p>
            {elapsed >= 30 && <p className="wechat-start-progress-hint">{sources.length ? "模型还在整理观点与开场白，请稍候。" : "资料服务响应较慢，请稍候。"}无需重复提交。</p>}
          </div>
        )}
        {sources.length > 0 && <details className="wechat-start-sources" open>
          <summary>{demo.enabled ? "本场使用的原创样例" : "已找到的真实资料"} · {sources.length} 条</summary>
          {sources.map((source) => <a key={source.id} href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a>)}
        </details>}
        {!busy && recent.length > 0 && onResume && (
          <div className="wechat-resume">
            <p className="wechat-resume-title">继续上次的圆桌</p>
            {recent.slice(0, 3).map((item) => (
              <button
                key={item.id}
                type="button"
                className="wechat-resume-item"
                onClick={() => onResume(item.id)}
              >
                <span className="wechat-resume-question">{item.question}</span>
                <span className="wechat-resume-meta">
                  {item.messages} 条发言 ·{" "}
                  {item.state === "complete" ? "已总结" : "进行中"} ·{" "}
                  {formatWhen(item.createdAt)}
                </span>
              </button>
            ))}
          </div>
        )}
        {error && <p className="wechat-error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
function formatWhen(iso: string) {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}
