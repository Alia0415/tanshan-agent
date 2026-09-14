"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mountain } from "lucide-react";
import type { Roundtable } from "@/lib/roundtable/engine";
import { readStartStream, type PreviewSource } from "@/lib/roundtable/start-stream";

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
  if (!response.ok) throw Object.assign(new Error(data.error?.message || "请求未完成。"), { code: data.error?.code });
  return data as T;
}
export function RoundtableWorkspace({ initialQuestion = "" }: { initialQuestion?: string }) {
  const joiningGuest = useRef(false);
  const [stageSummaries, setStageSummaries] = useState<Record<string, string>>({});
  const receiveSummaries = useCallback((result: Record<string, string>) => {
    setStageSummaries((current) => ({ ...current, ...result }));
  }, []);
  const [round, setRound] = useState<Roundtable | null>(null);
  const [question, setQuestion] = useState(initialQuestion);
  const [scene, setScene] = useState<string | null>("night");
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [previewSources, setPreviewSources] = useState<PreviewSource[]>([]);
  async function start() {
    if (!question.trim() || busy) return;
    setBusy("正在检索并组建圆桌");
    setPreviewSources([]);
    setError("");
    try {
      const response = await fetch("/api/roundtables", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
        body: JSON.stringify({ question: question.trim() }),
        signal: AbortSignal.timeout(150_000),
      });
      const result = await readStartStream(response, (message, sources) => {
        setBusy(message);
        if (sources) setPreviewSources(sources);
      });
      setRound(result);
    } catch (cause) {
      setError(cause instanceof Error && cause.name === "TimeoutError"
        ? "本次等待超时，请稍后重试。" : cause instanceof Error ? cause.message : "发起失败。");
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
        await api<Roundtable>(`/api/roundtables/${round.id}/advance`, "POST", { expectedTurn: round.scheduler.turn }),
      );
    } catch (cause) {
      // A summary or another tab may own the lock; no paid call has started.
      if ((cause as { code?: string })?.code === "ROUNDTABLE_BUSY") return;
      setPlaying(false);
      setError(cause instanceof Error ? cause.message : "本轮未完成。");
    } finally {
      setBusy("");
    }
  }
  // Fetch the next turn while the current scene animates, instead of waiting for it.
  useEffect(() => {
    if (!playing || busy || !round || round.scheduler.state === "complete") return;
    const timer = setTimeout(() => void advanceOnce(), 800);
    return () => clearTimeout(timer);
  });
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
  async function invite(guestId: string): Promise<boolean> {
    if (!round || busy || joiningGuest.current) return false;
    joiningGuest.current = true;
    setBusy("Agent 正在加入讨论");
    setError("");
    try {
      setRound(await api<Roundtable>(`/api/roundtables/${round.id}/guests`, "POST", { guestId }));
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加入失败，请重新拖入。");
      return false;
    } finally {
      joiningGuest.current = false;
      setBusy("");
    }
  }
  return (
    <main className="roundtable-page">
      <h1 className="roundtable-title">
        <Mountain size={22} aria-hidden="true" />
        观点圆桌
      </h1>
      <div className="roundtable-live-layout">
        <div className="roundtable-live-stage">
          <RoomStage
            summaries={stageSummaries}
            key={round?.id ?? "empty"}
            onJoinGuest={invite}
            canJoinGuest={!!round && !busy}
            round={
              round ?? {
                roles: [],
                messages: [],
                scheduler: { state: "running", turn: 0 },
              }
            }
            visible={round?.messages.length ?? 0}
            scene={scene ?? "night"}
            onScene={setScene}
          />
          {round && (
            <section className="roundtable-summary">
              <h2>本场资料与结论</h2>
              {!!round.issues?.length && <>
                <h3>讨论议题</h3>
                <ul>{round.issues.map((issue) => <li key={issue.id}>
                  {issue.question} · {{ open: "待讨论", resolved: "已澄清", needs_evidence: "待补证据", stalled: "保留分歧" }[issue.state]}
                  {issue.reason && <p>{issue.reason}</p>}
                </li>)}</ul>
              </>}
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
          {round ? (
            <WeChatChat
              onSummaries={receiveSummaries}
              round={round}
              busy={busy}
              error={error}
              playing={playing}
              onSend={(content) => void send(content)}
              onTogglePlaying={() => setPlaying(!playing)}
            />
          ) : (
            <WeChatIntro
              sources={previewSources}
              question={question}
              setQuestion={setQuestion}
              busy={busy}
              error={error}
              onStart={() => void start()}
            />
          )}
        </aside>
      </div>
    </main>
  );
}
