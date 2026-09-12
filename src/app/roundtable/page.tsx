"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Mountain, Send } from "lucide-react";
import type { Roundtable } from "@/lib/roundtable/engine";

const phaseLabels: Record<string, string> = {
  opening: "开场",
  statement: "观点陈述",
  exchange: "观点交锋",
  summary: "主持人总结",
  user: "访客发言",
};
async function api<T>(path: string, method = "GET", payload?: unknown) {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    signal: AbortSignal.timeout(150_000),
    ...(payload
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "请求未完成。");
  return data as T;
}
export default function RoundtablePage() {
  const [round, setRound] = useState<Roundtable | null>(null);
  const [question, setQuestion] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [round?.messages.length, busy]);
  const nameOf = (speaker: string) =>
    speaker === "user"
      ? "我"
      : (round?.roles.find((role) => role.id === speaker)?.name ?? speaker);
  async function start() {
    if (!question.trim() || busy) return;
    setBusy("正在检索并组建圆桌");
    setError("");
    try {
      const result = await api<{ roundtable: Roundtable }>(
        "/api/roundtables",
        "POST",
        { question: question.trim() },
      );
      setRound(result.roundtable);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "发起失败。");
    } finally {
      setBusy("");
    }
  }
  async function advanceOnce() {
    if (!round || busy) return;
    setBusy("主持人正在安排发言");
    setError("");
    try {
      const result = await api<Roundtable>(
        `/api/roundtables/${round.id}/advance`,
        "POST",
      );
      setRound(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "本轮未完成。");
    } finally {
      setBusy("");
    }
  }
  async function send() {
    if (!round || !draft.trim() || busy) return;
    setBusy("Agent 正在回应你");
    setError("");
    try {
      const result = await api<Roundtable>(
        `/api/roundtables/${round.id}/messages`,
        "POST",
        { content: draft.trim() },
      );
      setRound(result);
      setDraft("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "发言未完成。");
    } finally {
      setBusy("");
    }
  }
  return (
    <main className="home" style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: 22, color: "#121212" }}>
        <Mountain size={22} style={{ marginRight: 8, verticalAlign: -4 }} />
        观点圆桌（调试入口）
      </h1>
      <p style={{ color: "#64748b", fontSize: 13 }}>
        需要配置 ZHIHU_ACCESS_SECRET。一次推进是一组发言（陈述整批 / 交锋成对 / 嘉宾插话 / 总结）。
      </p>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {!round ? (
        <form
          className="question-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void start();
          }}
        >
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="输入一个有不少不同观点的知乎问题，例如：为什么很多人选择读博来延续学生身份？"
            disabled={Boolean(busy)}
          />
          <div className="composer-footer">
            <span />
            <button className="send-button" type="submit" disabled={Boolean(busy) || !question.trim()}>
              {busy ? <LoaderCircle size={17} className="spin" /> : "组局"}
            </button>
          </div>
        </form>
      ) : (
        <>
          <div
            ref={listRef}
            className="transcript"
            style={{
              maxHeight: "55vh",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 12,
              padding: 4,
            }}
          >
            {round.messages.map((message, index) => {
              const previous = round.messages[index - 1];
              return (
                <div key={message.id}>
                  {previous?.phase !== message.phase && (
                    <div style={{ textAlign: "center", fontSize: 11, color: "#8590a6", margin: "8px 0" }}>
                      —— {phaseLabels[message.phase] ?? message.phase} ——
                    </div>
                  )}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: message.speaker === "user" ? "flex-end" : "flex-start",
                    }}
                  >
                    <div
                      className="panel"
                      style={{
                        maxWidth: "78%",
                        padding: "10px 14px",
                        background: message.speaker === "user" ? "#056de8" : "#fff",
                        color: message.speaker === "user" ? "#fff" : "#444",
                        borderRadius: 12,
                        fontSize: 14,
                        lineHeight: 1.7,
                      }}
                    >
                      {message.speaker !== "user" && (
                        <div style={{ fontSize: 11, color: "#8590a6", marginBottom: 4 }}>
                          {nameOf(message.speaker)}
                        </div>
                      )}
                      {message.content}
                      {message.citations.length > 0 && (
                        <div style={{ fontSize: 10, opacity: 0.7, marginTop: 4 }}>
                          引用 {message.citations.length} 条来源
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 14, alignItems: "center" }}>
            <button
              className="primary"
              type="button"
              onClick={() => void advanceOnce()}
              disabled={Boolean(busy) || round.scheduler.state === "complete"}
            >
              {busy ? <LoaderCircle size={15} className="spin" /> : "推进一轮"}
            </button>
            <span style={{ fontSize: 11, color: "#8590a6" }}>
              {round.scheduler.state === "complete" ? "本场已总结，仍可继续发言" : `${round.messages.length} 条发言`}
            </span>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
            style={{ display: "flex", gap: 10, marginTop: 10 }}
          >
            <input
              value={draft}
              maxLength={300}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="说一句话加入讨论，最相关的 Agent 会回应你"
              disabled={Boolean(busy)}
              style={{ flex: 1 }}
            />
            <button className="primary" type="submit" disabled={Boolean(busy) || !draft.trim()}>
              <Send size={15} />
            </button>
          </form>
        </>
      )}
    </main>
  );
}
