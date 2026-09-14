"use client";

import { useEffect, useRef, useState } from "react";
import { Mountain } from "lucide-react";
import type { Roundtable, RoundtableSummary } from "@/lib/roundtable/engine";

import { RoomStage } from "./roundtable/room-stage";
import { WeChatChat, WeChatIntro } from "./roundtable/wechat-chat";
import "./roundtable/roundtable.css";

class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}
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
  if (!response.ok)
    throw new ApiError(
      data.error?.message || "请求未完成。",
      data.error?.code || "UNKNOWN",
    );
  return data as T;
}
const describe = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback;
type Prefetch = { promise: Promise<Roundtable>; result?: Roundtable };

export function RoundtableWorkspace({ initialQuestion = "" }: { initialQuestion?: string }) {
  const [round, setRound] = useState<Roundtable | null>(null);
  const [recent, setRecent] = useState<RoundtableSummary[]>([]);
  const [question, setQuestion] = useState(initialQuestion);
  const [scene, setScene] = useState<string | null>("night");
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  // Async callbacks read the latest round/playing through refs; the prefetch
  // holds the next turn until the stage has finished showing the current one.
  const roundRef = useRef<Roundtable | null>(null);
  const playingRef = useRef(false);
  const prefetchRef = useRef<Prefetch | null>(null);
  useEffect(() => {
    roundRef.current = round;
  }, [round]);
  // Discussions live on the server for a day; offer them back after a refresh.
  useEffect(() => {
    let cancelled = false;
    api<{ roundtables: RoundtableSummary[] }>("/api/roundtables")
      .then((data) => {
        if (!cancelled) setRecent(data.roundtables);
      })
      .catch(() => {
        /* A browser without a session simply has nothing to resume. */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  async function fetchRound(id: string) {
    const data = await api<{ roundtable: Roundtable }>(`/api/roundtables/${id}`);
    return data.roundtable;
  }
  // Another tab (or a retried request) moved the discussion on: adopt the
  // server copy instead of surfacing the conflict as a failure.
  async function post(
    path: string,
    payload: Record<string, unknown>,
    base: Roundtable,
    fallback: string,
  ): Promise<Roundtable> {
    try {
      return await api<Roundtable>(path, "POST", {
        ...payload,
        requestId: crypto.randomUUID(),
        revision: base.revision,
      });
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "ROUND_UPDATED")
        return fetchRound(base.id);
      throw new Error(describe(cause, fallback));
    }
  }
  const requestAdvance = (base: Roundtable) =>
    post(`/api/roundtables/${base.id}/advance`, {}, base, "本轮未完成。");
  // While a turn is on stage the next one is already being generated, so the
  // model latency overlaps the 16-second playback instead of following it.
  function prefetch(base: Roundtable) {
    if (prefetchRef.current || base.scheduler.state === "complete") return;
    const entry: Prefetch = { promise: requestAdvance(base) };
    entry.promise.then(
      (result) => {
        entry.result = result;
      },
      () => {
        /* Surfaced to the user when the prefetch is consumed. */
      },
    );
    prefetchRef.current = entry;
  }
  // Hand over the prefetched turn (waiting for it if still in flight); the
  // server serialises turns, so nothing else may be sent until it settles.
  async function takePrefetch(): Promise<Roundtable | null> {
    const entry = prefetchRef.current;
    if (!entry) return null;
    prefetchRef.current = null;
    return entry.promise;
  }
  useEffect(() => {
    playingRef.current = playing;
    if (playing && round && round.scheduler.state !== "complete") prefetch(round);
    // The prefetch only needs to start when playback starts; later turns
    // schedule their own successor after they are shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);
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
      setError(describe(cause, "发起失败。"));
    } finally {
      setBusy("");
    }
  }
  async function resume(id: string) {
    if (busy) return;
    setBusy("正在恢复上次的圆桌");
    setError("");
    try {
      setRound(await fetchRound(id));
    } catch (cause) {
      setRecent((items) => items.filter((item) => item.id !== id));
      setError(describe(cause, "这场圆桌无法恢复。"));
    } finally {
      setBusy("");
    }
  }
  async function advanceOnce() {
    const current = roundRef.current;
    if (!current || busy || current.scheduler.state === "complete") return;
    // Only show the typing indicator when the turn is not already here.
    if (!prefetchRef.current?.result) setBusy("主持人正在安排发言");
    setError("");
    try {
      const next = (await takePrefetch()) ?? (await requestAdvance(current));
      setRound(next);
      if (playingRef.current) prefetch(next);
    } catch (cause) {
      setPlaying(false);
      setError(describe(cause, "本轮未完成。"));
    } finally {
      setBusy("");
    }
  }
  async function send(content: string) {
    let current = roundRef.current;
    if (!current || busy) return;
    setBusy("Agent 正在回应你");
    setError("");
    try {
      // Adopt a prefetched turn first so the reply is sent against the latest revision.
      const ready = await takePrefetch().catch(() => null);
      if (ready) {
        current = ready;
        setRound(ready);
      }
      const next = await post(
        `/api/roundtables/${current.id}/messages`,
        { content },
        current,
        "发言未完成。",
      );
      setRound(next);
      if (playingRef.current) prefetch(next);
    } catch (cause) {
      setError(describe(cause, "发言未完成。"));
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
              error={error}
              recent={recent}
              onStart={() => void start()}
              onResume={(id) => void resume(id)}
            />
          )}
        </aside>
      </div>
    </main>
  );
}
