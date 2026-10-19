"use client";
import { useDemoMode } from "./demo-mode";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mountain } from "lucide-react";
import type { Roundtable, RoundtableSummary } from "@/lib/roundtable/engine";
import { readStartStream, type PreviewSource } from "@/lib/roundtable/start-stream";
import { acceptsRoundtableUpdate, parseSavedRoundtable, ROUNDTABLE_STORAGE_KEY, roundtableUnavailable, savedRoundtable } from "@/lib/roundtable/client-state";

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
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error?.message || "请求未完成。"), { code: data.error?.code });
  return data as T;
}
export function RoundtableWorkspace({ initialQuestion = "" }: { initialQuestion?: string }) {
  const demo = useDemoMode();
  const joiningGuest = useRef(false);
  const mutationPending = useRef(false);
  const [stageSummaries, setStageSummaries] = useState<Record<string, string>>({});
  const receiveSummaries = useCallback((result: Record<string, string>) => {
    setStageSummaries((current) => ({ ...current, ...result }));
  }, []);
  const [round, setRound] = useState<Roundtable | null>(null);
  const [recent, setRecent] = useState<RoundtableSummary[]>([]);
  const [question, setQuestion] = useState(initialQuestion);
  const [scene, setScene] = useState<string | null>("night");
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [previewSources, setPreviewSources] = useState<PreviewSource[]>([]);
  const receiveRound = useCallback((incoming: Roundtable) => {
    setRound(current => current && acceptsRoundtableUpdate(current, incoming) ? incoming : current);
  }, []);
  useEffect(() => {
    if (!round) return;
    try {
      const saved = savedRoundtable(round);
      if (saved) sessionStorage.setItem(ROUNDTABLE_STORAGE_KEY, JSON.stringify(saved));
      else sessionStorage.removeItem(ROUNDTABLE_STORAGE_KEY);
    } catch { /* Storage may be unavailable; keep the current discussion usable. */ }
  }, [round]);
  // Discussions live on the server for a day; offer them back after a refresh.
  useEffect(() => {
    let cancelled = false;
    let saved;
    try { saved = parseSavedRoundtable(sessionStorage.getItem(ROUNDTABLE_STORAGE_KEY)); } catch { /* Private browsing may disable storage. */ }
    const local = saved && demo.enabled ? [saved] : [];
    api<{ roundtables: RoundtableSummary[] }>("/api/roundtables")
      .then((data) => {
        if (!cancelled) setRecent([...local, ...data.roundtables.filter(item => !local.some(cached => cached.id === item.id))]);
      })
      .catch(() => {
        if (!cancelled) setRecent(local);
      });
    return () => {
      cancelled = true;
    };
  }, [demo.enabled]);
  async function start() {
    if (!question.trim() || busy || mutationPending.current) return;
    mutationPending.current = true;
    setBusy(demo.enabled ? "正在载入样例并组建圆桌" : "正在检索并组建圆桌");
    setPreviewSources([]);
    setError("");
    setUnavailable(false);
    setPlaying(false);
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
      setStageSummaries({});
      setRound(result);
    } catch (cause) {
      setError(cause instanceof Error && cause.name === "TimeoutError"
        ? "本次等待超时，请稍后重试。" : cause instanceof Error ? cause.message : "发起失败。");
    } finally {
      mutationPending.current = false;
      setBusy("");
    }
  }
  async function resume(id: string) {
    if (busy || mutationPending.current) return;
    mutationPending.current = true;
    setBusy("正在恢复上次的圆桌");
    setError("");
    try {
      let cached;
      try { cached = parseSavedRoundtable(sessionStorage.getItem(ROUNDTABLE_STORAGE_KEY)); } catch { /* Optional recovery cache. */ }
      const checkpoint = cached?.id === id ? cached.checkpoint : undefined;
      const data = await api<{ roundtable: Roundtable }>(`/api/roundtables/${id}`, checkpoint ? "POST" : "GET", checkpoint ? { checkpoint } : undefined);
      setStageSummaries({});
      setUnavailable(false);
      setPlaying(false);
      setRound(data.roundtable);
    } catch (cause) {
      setRecent((items) => items.filter((item) => item.id !== id));
      setError(cause instanceof Error ? cause.message : "这场圆桌无法恢复。");
    } finally {
      mutationPending.current = false;
      setBusy("");
    }
  }
  async function advanceOnce() {
    if (!round || busy || unavailable || mutationPending.current || round.scheduler.state === "complete") return;
    mutationPending.current = true;
    setBusy("主持人正在安排发言");
    setError("");
    try {
      receiveRound(
        await api<Roundtable>(`/api/roundtables/${round.id}/advance`, "POST", { expectedTurn: round.scheduler.turn, checkpoint: round.checkpoint }),
      );
    } catch (cause) {
      // A summary or another tab may own the lock; no paid call has started.
      if ((cause as { code?: string })?.code === "ROUNDTABLE_BUSY") return;
      setPlaying(false);
      if (roundtableUnavailable(cause)) setUnavailable(true);
      setError(cause instanceof Error ? cause.message : "本轮未完成。");
    } finally {
      mutationPending.current = false;
      setBusy("");
    }
  }
  // Fetch the next turn while the current scene animates, instead of waiting for it.
  useEffect(() => {
    if (!playing || busy || unavailable || !round || round.scheduler.state === "complete") return;
    const timer = setTimeout(() => void advanceOnce(), 800);
    return () => clearTimeout(timer);
  });
  async function send(content: string) {
    if (!round || busy || unavailable || mutationPending.current) return;
    mutationPending.current = true;
    setPlaying(false);
    setBusy("Agent 正在回应你");
    setError("");
    try {
      receiveRound(
        await api<Roundtable>(`/api/roundtables/${round.id}/messages`, "POST", {
          content,
          checkpoint: round.checkpoint,
        }),
      );
    } catch (cause) {
      setPlaying(false);
      if (roundtableUnavailable(cause)) setUnavailable(true);
      setError(cause instanceof Error ? cause.message : "发言未完成。");
    } finally {
      mutationPending.current = false;
      setBusy("");
    }
  }
  async function invite(guestId: string): Promise<boolean> {
    if (!round || busy || unavailable || joiningGuest.current || mutationPending.current) return false;
    mutationPending.current = true;
    joiningGuest.current = true;
    setBusy("Agent 正在加入讨论");
    setError("");
    try {
      receiveRound(await api<Roundtable>(`/api/roundtables/${round.id}/guests`, "POST", { guestId, checkpoint: round.checkpoint }));
      return true;
    } catch (cause) {
      setPlaying(false);
      if (roundtableUnavailable(cause)) setUnavailable(true);
      setError(cause instanceof Error ? cause.message : "加入失败，请重新拖入。");
      return false;
    } finally {
      mutationPending.current = false;
      joiningGuest.current = false;
      setBusy("");
    }
  }
  function restart() {
    if (busy || mutationPending.current) return;
    if (round) setQuestion(round.question);
    try { sessionStorage.removeItem(ROUNDTABLE_STORAGE_KEY); } catch { /* Optional storage. */ }
    setRound(null);
    setStageSummaries({});
    setPlaying(false);
    setUnavailable(false);
    setError("");
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
            canJoinGuest={!!round && !busy && !unavailable}
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
                <summary>查看 {round.sources.length} 条{round.provider === "demo" ? "原创样例" : "真实来源"}</summary>
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
              key={round.id}
              onSummaries={receiveSummaries}
              onRoundUpdated={receiveRound}
              unavailable={unavailable}
              onRestart={restart}
              round={round}
              busy={busy}
              error={error}
              playing={playing}
              onSend={(content) => void send(content)}
              onTogglePlaying={() => { if (!unavailable) setPlaying(!playing); }}
            />
          ) : (
            <WeChatIntro
              sources={previewSources}
              recent={recent}
              question={question}
              setQuestion={setQuestion}
              busy={busy}
              error={error}
              onStart={() => void start()}
              onResume={(id) => void resume(id)}
            />
          )}
        </aside>
      </div>
    </main>
  );
}
