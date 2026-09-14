"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Send, Sparkles } from "lucide-react";
import type { Roundtable, RoundtableSummary } from "@/lib/roundtable/engine";

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
  onAdvance,
  onTogglePlaying,
}: {
  round: Roundtable;
  busy: string;
  error: string;
  playing: boolean;
  onSend: (content: string) => void;
  onAdvance: () => void;
  onTogglePlaying: () => void;
}) {
  const [draft, setDraft] = useState("");
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
                    <p>{message.content}</p>
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
          disabled={Boolean(busy) || complete}
        >
          {playing ? "暂停自动讨论" : "自动讨论"}
        </button>
        <button
          type="button"
          className="wechat-tool"
          onClick={onAdvance}
          disabled={Boolean(busy) || complete}
        >
          {busy ? <LoaderCircle size={13} className="spin" /> : null}
          推进一轮
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
// Debatable, Zhihu-flavoured openers; kept short so every chip stays two lines.
export const EXAMPLE_QUESTIONS = [
  "为什么很多人选择读博来延续学生身份？",
  "年轻人该留在大城市还是回家乡？",
  "AI 会取代程序员吗？",
  "提前还房贷真的划算吗？",
];
export function WeChatIntro({
  question,
  setQuestion,
  busy,
  error,
  recent,
  onStart,
  onResume,
}: {
  question: string;
  setQuestion: (value: string) => void;
  busy: string;
  error: string;
  recent: RoundtableSummary[];
  onStart: () => void;
  onResume: (id: string) => void;
}) {
  return (
    <div className="wechat-phone">
      <header className="wechat-header">
        <span className="wechat-header-title">观点圆桌</span>
        <span className="wechat-header-sub">需要配置知乎凭证后开局</span>
      </header>
      <div className="wechat-body wechat-intro">
        <Sparkles size={30} className="wechat-intro-icon" />
        <h3>
          <span className="copy-desktop">把一个问题交给几个立场</span>
          <span className="copy-mobile">跟不同观点的代表谈谈</span>
        </h3>
        <p>真实检索知乎帖子，生成不同立场的 Agent 开一场可插话的圆桌。</p>
        <div className="wechat-examples" role="group" aria-label="示例问题">
          <p className="wechat-examples-title">试试这些问题</p>
          <div className="wechat-examples-grid">
            {EXAMPLE_QUESTIONS.map((item) => (
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
          {busy ? <LoaderCircle size={16} className="spin" /> : "组局"}
        </button>
        {busy ? (
          <div className="wechat-typing">{busy}…</div>
        ) : (
          recent.length > 0 && (
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
          )
        )}
        {error && (
          <p className="wechat-error" role="alert">
            {error}
          </p>
        )}
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
