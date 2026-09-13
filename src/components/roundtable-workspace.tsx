"use client";

import { useState } from "react";
import { Mountain } from "lucide-react";
import type { Roundtable } from "@/lib/roundtable/engine";

import { RoomStage } from "./roundtable/room-stage";
import { WeChatChat, WeChatIntro } from "./roundtable/wechat-chat";
import "./roundtable/roundtable.css";

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
export function RoundtableWorkspace({ initialQuestion = "" }: { initialQuestion?: string }) {
  const [round, setRound] = useState<Roundtable | null>(null);
  const [question, setQuestion] = useState(initialQuestion);
  const [scene, setScene] = useState<string | null>("night");
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function start() {
    if (!question.trim() || busy) return;
    setBusy("正在检索并组建圆桌");
    setError("");
    try {
      const result = await api<Roundtable>("/api/roundtables", "POST", {
        question: question.trim(),
      });
      setRound(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "发起失败。");
    } finally {
      setBusy("");
    }
  }
  async function advanceOnce() {
    if (!round || busy || round.scheduler.state === "complete") return;
    setBusy("主持人正在安排发言");
    setError("");
    try {
      setRound(
        await api<Roundtable>(`/api/roundtables/${round.id}/advance`, "POST"),
      );
    } catch (cause) {
      setPlaying(false);
      setError(cause instanceof Error ? cause.message : "本轮未完成。");
    } finally {
      setBusy("");
    }
  }
  async function send(content: string) {
    if (!round || busy) return;
    setBusy("Agent 正在回应你");
    setError("");
    try {
      setRound(
        await api<Roundtable>(`/api/roundtables/${round.id}/messages`, "POST", {
          content,
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "发言未完成。");
    } finally {
      setBusy("");
    }
  }
  const complete = round?.scheduler.state === "complete";
  return (
    <main className="roundtable-page">
      <h1 className="roundtable-title">
        <Mountain size={22} aria-hidden="true" />
        观点圆桌
      </h1>
      <div className="roundtable-live-layout">
        <div className="roundtable-live-stage">
          <RoomStage
            round={
              round ?? {
                roles: [],
                messages: [],
                scheduler: { state: "running", turn: 0 },
              }
            }
            visible={round?.messages.length ?? 0}
            playing={playing && !busy && !complete}
            scene={scene ?? "night"}
            onScene={setScene}
            onTurnEnd={() => void advanceOnce()}
          />
          {round && (
            <section className="roundtable-summary">
              <h2>本场资料与结论</h2>
              {round.commonGround.length > 0 && (
                <>
                  <h3>共识</h3>
                  <ul>
                    {round.commonGround.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </>
              )}
              {round.disagreements.length > 0 && (
                <>
                  <h3>分歧</h3>
                  <ul>
                    {round.disagreements.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </>
              )}
              <details>
                <summary>查看 {round.sources.length} 条真实来源</summary>
                {round.sources.map((source) => (
                  <p key={source.id}>
                    <a href={source.url} target="_blank" rel="noreferrer">
                      [{source.id}] {source.title}
                    </a>{" "}
                    · {source.author}
                  </p>
                ))}
              </details>
            </section>
          )}
        </div>
        <aside className="roundtable-live-chat" aria-label="圆桌群聊">
          {/* 场景设置 / Agent 库的承载槽：RoomStage 通过 portal 渲染到这里 */}
          <div id="chat-controls-slot" className="chat-controls-slot" />
          {round ? (
            <WeChatChat
              round={round}
              busy={busy}
              error={error}
              playing={playing}
              onSend={(content) => void send(content)}
              onAdvance={() => void advanceOnce()}
              onTogglePlaying={() => setPlaying(!playing)}
            />
          ) : (
            <WeChatIntro
              question={question}
              setQuestion={setQuestion}
              busy={busy}
              onStart={() => void start()}
            />
          )}
        </aside>
      </div>
    </main>
  );
}
