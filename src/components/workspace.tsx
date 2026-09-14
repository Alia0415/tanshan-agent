"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  ArrowUp,
  BookOpen,
  Camera,
  Check,
  BriefcaseBusiness,
  Compass,
  GraduationCap,
  Leaf,
  LoaderCircle,
  MessageCircle,
  MessagesSquare,
  MoreHorizontal,
  Mountain,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RotateCcw,
  Trash2,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { MAX_CLARIFICATION_ROUNDS, type Context, type ContextPatch, type Session, type SessionSummary } from "@/lib/domain/types";
import { ContextFields, ContextTags } from "./context-fields";
import { AnswerCard } from "./answer-card";
import { WaveProgressFloat } from "./wave-progress";
import { SearchProgress } from "./search-progress";
import homeStyles from "./workspace-home.module.css";

type Result = { session: Session; auto_answer?: boolean };
const STORAGE_KEY = "wenshan.agent-session-v2";
const productEntries = [
  {
    href: "/reading",
    icon: BookOpen,
    title: "阅读助手",
    eyebrow: "READING MAP",
    description: "从知乎讨论里整理线索，生成可继续探索的阅读地图。",
    image: "/entry-previews/reading-preview.png",
    imageHeight: 267,
  },
  {
    href: "/roundtable",
    icon: MessagesSquare,
    title: "观点圆桌",
    eyebrow: "AGENT ROUNDTABLE",
    description: "让不同立场的 Agent 开诚交锋，看见问题的多个侧面。",
    image: "/entry-previews/roundtable-preview.png",
    imageHeight: 251,
  },
];
const examples = [
  {
    icon: BriefcaseBusiness,
    category: "职业选择",
    text: "要不要从大公司去创业公司？",
    lines: ["要不要从大公司", "去创业公司？"],
    hint: "把选择放回自己的处境",
  },
  {
    icon: Camera,
    category: "消费决策",
    text: "想买一台相机，应该怎么选？",
    lines: ["想买一台相机，", "应该怎么选？"],
    hint: "先确认用途，再比较参数",
  },
  {
    icon: Leaf,
    category: "生活关系",
    text: "和室友作息不同，怎么办？",
    lines: ["和室友作息不同，", "怎么办？"],
    hint: "听见经验，也梳理边界",
  },
  {
    icon: GraduationCap,
    category: "学业规划",
    text: "我真的适合读博吗？",
    lines: ["我真的适合", "读博吗？"],
    hint: "兴趣、机会成本与长期目标",
  },
  {
    icon: Compass,
    category: "成长路径",
    text: "想转行进入 AI，现在开始晚吗？",
    lines: ["想转行进入 AI，", "现在开始晚吗？"],
    hint: "从现实条件出发找到下一步",
  },
];
const emptyContext = (): Context => ({ priorities: [] });

class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
  }
}
async function api<T>(
  path: string,
  method = "GET",
  payload?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    signal: AbortSignal.timeout(method === "POST" ? 45000 : 20000),
    ...(payload
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      : {}),
  });
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(
      data.error?.message || "请求未完成，请稍后重试。",
      data.error?.code || "UNKNOWN",
    );
  return data;
}
function remember(id?: string) {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* Browsers without storage can still complete the current flow. */
  }
}

export function Workspace({ initialQuestion = "" }: { initialQuestion?: string }) {
  const [session, setSession] = useState<Session | null>(null);
  const [question, setQuestion] = useState(initialQuestion);
  const [context, setContext] = useState<Context>(emptyContext);
  const [freeText, setFreeText] = useState("");
  const [clarificationAnswers, setClarificationAnswers] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [restoring, setRestoring] = useState(true);
  const [finishingClarification, setFinishingClarification] = useState(false);
  const [about, setAbout] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyResult, setHistoryResult] = useState<{ answerId: string } | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [history, setHistory] = useState<SessionSummary[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [connectionLost, setConnectionLost] = useState(false);
  const [reconnect, setReconnect] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<SessionSummary | null>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const deletedSessions = useRef(new Set<string>());
  const lock = useRef(false);
  const epoch = useRef(0);
  const questionInput = useRef<HTMLTextAreaElement>(null);
  const pendingAnswer = useRef<{ key: string; id: string } | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await api<{ sessions: SessionSummary[] }>(
          "/api/sessions",
        );
        if (active) {
          setHistory(result.sessions.filter((item) => !deletedSessions.current.has(item.session_id)));
          setHistoryLoaded(true);
        }
      } catch {
        // 侧边栏历史仅作展示，加载失败时保持空态即可。
      }
    })();
    return () => {
      active = false;
    };
  }, [session?.session_id, session?.answers.length]);

  useEffect(() => {
    if (!historyResult || historyOpen) return;
    document.getElementById("history-post-results")?.scrollIntoView({ block: "start" });
  }, [historyResult, historyOpen]);

  function dialogKeys(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") setAbout(false);
    if (event.key !== "Tab") return;
    const buttons =
      event.currentTarget.querySelectorAll<HTMLButtonElement>("button");
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function apply(next: Session) {
    if (session?.stage === "clarifying" && next.stage !== "clarifying") {
      setFinishingClarification(true);
    }
    setClarificationAnswers([]);
    setSession((previous) =>
      previous &&
      previous.session_id === next.session_id &&
      previous.context_version > next.context_version
        ? previous
        : next,
    );
    setContext(structuredClone(next.confirmed_context));
    remember(next.session_id);
  }

  useEffect(() => {
    let active = true;
    const initialEpoch = epoch.current;
    async function restore() {
      try {
        if (initialQuestion) return;
        const id = localStorage.getItem(STORAGE_KEY);
        if (!id) return;
        const result = await api<Result>(
          `/api/sessions/${encodeURIComponent(id)}`,
        );
        if (active && initialEpoch === epoch.current) {
          setSession(result.session);
          setContext(result.session.confirmed_context);
        }
      } catch (error) {
        if (active) {
          if (error instanceof ApiError && error.code === "SESSION_NOT_FOUND")
            remember();
          setNotice(
            error instanceof ApiError
              ? error.message
              : "暂时无法恢复会话，刷新页面可以重新连接。",
          );
        }
      } finally {
        if (active) setRestoring(false);
      }
    }
    void restore();
    return () => {
      active = false;
    };
  }, [initialQuestion]);

  useEffect(() => {
    if (!finishingClarification) return;
    // Let the 1-second rise finish, then hold the full orb briefly.
    const timer = setTimeout(() => setFinishingClarification(false), 1800);
    return () => clearTimeout(timer);
  }, [finishingClarification]);

  const sessionId = session?.session_id;
  const version = session?.context_version;
  const stage = session?.stage;
  useEffect(() => {
    if (!sessionId || !["searching", "generating"].includes(stage || ""))
      return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    const pollingEpoch = epoch.current;
    async function poll() {
      try {
        const result = await api<Result>(`/api/sessions/${sessionId}`);
        if (!active || pollingEpoch !== epoch.current) return;
        failures = 0;
        setConnectionLost(false);
        setSession((previous) =>
          previous && previous.context_version > result.session.context_version
            ? previous
            : result.session,
        );
        if (!["searching", "generating"].includes(result.session.stage)) return;
      } catch {
        failures += 1;
        if (!active) return;
        if (failures >= 3) {
          setConnectionLost(true);
          return;
        }
      }
      if (active) timer = setTimeout(poll, 1000);
    }
    timer = setTimeout(poll, 500);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [sessionId, version, stage, reconnect]);

  async function run(label: string, action: (ticket: number) => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(label);
    setNotice("");
    const ticket = epoch.current;
    try {
      await action(ticket);
    } catch (error) {
      if (ticket !== epoch.current) return;
      setNotice(
        error instanceof ApiError
          ? error.message
          : "连接暂时中断。可以刷新恢复状态，不会自动重复生成。",
      );
      if (
        error instanceof ApiError &&
        error.code === "CONTEXT_CHANGED" &&
        session
      ) {
        try {
          const result = await api<Result>(
            `/api/sessions/${session.session_id}`,
          );
          if (ticket === epoch.current) apply(result.session);
        } catch {
          /* Keep the last visible state. */
        }
      }
    } finally {
      lock.current = false;
      if (ticket === epoch.current) setBusy("");
    }
  }

  async function generate(current: Session, ticket: number) {
    setBusy("正在开始分析");
    const key = `${current.session_id}:${current.context_version}`;
    if (pendingAnswer.current?.key !== key)
      pendingAnswer.current = { key, id: crypto.randomUUID() };
    const result = await api<Result>(
      `/api/sessions/${current.session_id}/answer`,
      "POST",
      {
        context_version: current.context_version,
        request_id: pendingAnswer.current.id,
      },
    );
    pendingAnswer.current = null;
    if (ticket === epoch.current) apply(result.session);
  }

  async function accept(result: Result, ticket: number) {
    if (ticket !== epoch.current) return;
    apply(result.session);
    setFreeText("");
    if (result.auto_answer) await generate(result.session, ticket);
  }

  function startQuestion() {
    if (!question.trim() || question.trim().length > 2000) return;
    void run("正在理解你的问题", async (ticket) =>
      accept(
        await api<Result>("/api/sessions", "POST", {
          question: question.trim(),
        }),
        ticket,
      ),
    );
  }
  function submitClarification(skip: boolean) {
    if (!session?.clarification) return;
    const selections: ContextPatch = {};
    for (const field of session.clarification.fields)
      if (context[field] !== undefined)
        Object.assign(selections, { [field]: context[field] });
    void run(skip ? "正在准备回答" : "正在判断是否还需要补充", async (ticket) =>
      accept(
        await api<Result>(
          `/api/sessions/${session.session_id}/clarifications`,
          "POST",
          {
            context_version: session.context_version,
            selections,
            ...(clarificationAnswers.length ? { answer: clarificationAnswers } : {}),
            free_text: freeText,
            skip,
          },
        ),
        ticket,
      ),
    );
  }
  async function loadRevisionChoices(label: string, answerId: string) {
    if (!session) throw new Error("会话已结束");
    const result = await api<{ history_index: number; card: import("@/lib/domain/types").ClarificationCard }>(
      "/api/sessions/" + session.session_id + "/revision-choices", "POST",
      { context_version: session.context_version, answer_id: answerId, label },
    );
    return result;
  }
  function editCondition(revision: import("@/lib/domain/types").ClarificationRevision) {
    if (!session) return;
    setHistoryResult(null);
    void run("正在保存新选择", async (ticket) => {
      const result = await api<Result>(
        "/api/sessions/" + session.session_id + "/context", "PATCH", {
          context_version: session.context_version,
          changes: {},
          clarification_revision: revision,
        },
      );
      if (ticket !== epoch.current) return;
      apply(result.session);
      await generate(result.session, ticket);
    });
  }
  function newQuestion() {
    if (busy) return;
    setHistoryResult(null);
    setHistoryOpen(false);
    epoch.current += 1;
    setSession(null);
    setFinishingClarification(false);
    setQuestion("");
    setContext(emptyContext());
    setFreeText("");
    setClarificationAnswers([]);
    setNotice("");
    setConnectionLost(false);
    remember();
    pendingAnswer.current = null;
    requestAnimationFrame(() => questionInput.current?.focus());
  }
  function openHistory() {
    if (lock.current || restoring) return;
    setHistoryOpen(true);
    setHistoryLoaded(false);
    void run("正在读取历史问题", async () => {
      const result = await api<{ sessions: SessionSummary[] }>("/api/sessions");
      setHistory(result.sessions.filter((item) => !deletedSessions.current.has(item.session_id)));
      setHistoryLoaded(true);
    });
  }
  function removeHistory(id: string) {
    if (lock.current || restoring) return;
    const item = history.find((entry) => entry.session_id === id);
    if (!item) return;
    setDeleteTarget(item);
    deleteDialog.current?.showModal();
  }
  function cancelDelete() {
    deleteDialog.current?.close();
    setDeleteTarget(null);
  }
  function confirmDelete() {
    if (!deleteTarget || lock.current || restoring) return;
    const id = deleteTarget.session_id;
    cancelDelete();
    void run("正在删除历史记录", async () => {
      await api("/api/sessions/" + encodeURIComponent(id), "DELETE", {});
      deletedSessions.current.add(id);
      setHistory((items) => items.filter((item) => item.session_id !== id));
      if (session?.session_id === id) {
        newQuestion();
        setHistoryOpen(historyOpen);
        setBusy("");
      }
    });
  }
  function openSession(id: string) {
    void run("正在打开问题", async () => {
      const result = await api<Result>(`/api/sessions/${encodeURIComponent(id)}`);
      epoch.current += 1;
      setSession(result.session);
      setContext(structuredClone(result.session.confirmed_context));
      const answer = result.session.answers.find(
        (item) => item.context_version === result.session.context_version,
      ) ?? result.session.answers.at(-1);
      setHistoryResult(result.session.stage === "completed" && answer ? { answerId: answer.id } : null);
      remember(id);
      setFreeText("");
      setClarificationAnswers([]);
      setFinishingClarification(false);
      setConnectionLost(false);
      pendingAnswer.current = null;
      setReconnect((value) => value + 1);
      setBusy("");
      setHistoryOpen(false);
    });
  }
  const stageLabels = { understanding: "理解中", clarifying: "待补充", ready: "待分析", searching: "检索中", generating: "生成中", completed: "已回答", error: "未完成" };
  const historyGroups = useMemo(() => {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const today = dayStart.getTime();
    const yesterday = today - 86_400_000;
    const groups: { label: string; items: SessionSummary[] }[] = [
      { label: "今天", items: [] },
      { label: "昨天", items: [] },
      { label: "更早", items: [] },
    ];
    for (const item of history) {
      const time = Date.parse(item.created_at);
      const index = time >= today ? 0 : time >= yesterday ? 1 : 2;
      groups[index].items.push(item);
    }
    return groups.filter((group) => group.items.length > 0);
  }, [history]);
  const isWorking =
    session && ["searching", "generating"].includes(session.stage);
  const showClarificationProgress =
    Boolean(session) &&
    !historyResult &&
    ((session?.stage === "clarifying" && Boolean(session.clarification)) || finishingClarification) &&
    !about && !historyOpen;
  const clarificationRound = Math.min(
    MAX_CLARIFICATION_ROUNDS,
    (session?.clarification_count ?? 0) + 1,
  );
  const currentAnswer = session?.answers.find(
    (answer) => answer.context_version === session.context_version,
  );
  const historyAnswer = session?.answers.find((answer) => answer.id === historyResult?.answerId);
  const displayedAnswer = historyAnswer ?? currentAnswer;
  const oldAnswers =
    session?.answers.filter(
      (answer) => answer.context_version !== session.context_version && answer.id !== historyAnswer?.id,
    ) || [];
  const feedback = async (
    answerId: string,
    type: "helpful" | "irrelevant",
    reason?: string,
  ) => {
    await api(`/api/sessions/${session!.session_id}/feedback`, "POST", {
      answer_id: answerId,
      type,
      reason,
    });
  };
  const isLanding = !session && !historyOpen;

  return (
    <div
      className={`app-shell agent-workspace${sidebarCollapsed ? " sidebar-collapsed" : ""}${isLanding ? ` ${homeStyles.landingMode}` : ""}${showClarificationProgress ? " has-clarification-progress" : ""}`}
    >
      <button
        type="button"
        className="sidebar-toggle"
        onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
        aria-label={sidebarCollapsed ? "展开边栏" : "收起边栏"}
        aria-expanded={!sidebarCollapsed}
        aria-controls="workspace-sidebar"
        title={sidebarCollapsed ? "展开边栏" : "收起边栏"}
      >
        {sidebarCollapsed ? <PanelLeftOpen size={19} aria-hidden="true" /> : <PanelLeftClose size={19} aria-hidden="true" />}
      </button>
      <aside id="workspace-sidebar" className="sidebar" inert={sidebarCollapsed}>
        <Link className="brand" href="/" aria-label="问山首页">
          <span className="brand-icon">
            <Mountain size={21} strokeWidth={1.7} />
          </span>
          <span>
            问山<small>WENSHAN</small>
          </span>
        </Link>
        <button
          type="button"
          className="new-question"
          onClick={newQuestion}
          disabled={Boolean(busy) || restoring}
        >
          <Plus size={16} />
          开启新提问
        </button>
        <nav className="side-history" aria-label="历史提问">
          {session && (
            <>
              <div className="side-group-label">当前</div>
              <button
                type="button"
                className="side-history-item active"
                onClick={() => {
                  setHistoryOpen(false);
                  document
                    .getElementById("main-content")
                    ?.scrollIntoView({ behavior: "smooth" });
                }}
                title={session.original_question}
              >
                <MessageCircle size={14} aria-hidden="true" />
                {session.original_question}
              </button>
            </>
          )}
          {historyGroups.map((group) => (
            <div className="side-group" key={group.label}>
              <div className="side-group-label">{group.label}</div>
              {group.items.map((item) => (
                <div className="history-row" key={item.session_id}>
                <button
                  type="button"
                  className={`side-history-item${
                    item.session_id === sessionId ? " current" : ""
                  }`}
                  disabled={Boolean(busy)}
                  onClick={() => openSession(item.session_id)}
                  title={item.original_question}
                >
                  {item.original_question}
                </button>
                <button type="button" className="history-delete" disabled={Boolean(busy) || restoring}
                  aria-label={"删除历史问题：" + item.original_question} title="删除记录"
                  onClick={() => removeHistory(item.session_id)}>
                  <Trash2 size={15} aria-hidden="true" />
                </button>
                </div>
              ))}
            </div>
          ))}
          {historyLoaded && history.length === 0 && (
            <p className="side-history-empty">
              还没有历史提问，
              <br />
              从上面开启第一次提问吧。
            </p>
          )}
        </nav>
        <div className="sidebar-bottom">
          <button
            type="button"
            className="side-user"
            onClick={() => setAbout(true)}
          >
            <span className="side-user-name">访客</span>
            <span className="side-mode">
              {session?.provider === "live" ? "联网问答" : "体验模式"}
            </span>
            <MoreHorizontal size={16} aria-hidden="true" />
          </button>
          <Link className="side-user" href="/me">
            <Image className="side-avatar zhihu" src="/zhihu-official.ico" alt="" width={20} height={20} unoptimized />
            <span className="side-user-name">我的知乎</span>
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span className="mobile-brand">
              <Mountain size={21} />
              问山
            </span>
            <Link className="header-brand" href="/">问山</Link>
            <nav className="header-nav" aria-label="主导航">
              <button type="button" className={historyOpen ? "" : "nav-current"} onClick={() => { setHistoryOpen(false); document.getElementById("main-content")?.scrollIntoView({ behavior: "smooth" }); }}>{session ? "当前提问" : "首页"}</button>
              <button type="button" className={historyOpen ? "nav-current" : ""} onClick={openHistory} disabled={Boolean(busy) || restoring}>历史问题</button>
              <button type="button" onClick={() => setAbout(true)}>关于问山</button>
            </nav>
          </div>
          <div className="topbar-right">
            <button
              type="button"
              className="mobile-new icon-button"
              aria-label="开始新的提问"
              onClick={newQuestion}
              disabled={Boolean(busy)}
            >
              <Plus size={20} />
            </button>
          </div>
        </header>
        <div className="agent-main-scroll">
          <main
            id="main-content"
            className={
              session
                ? "conversation"
                : isLanding
                  ? `home ${homeStyles.homeLanding}`
                  : "home"
            }
          >
          {notice && (
            <div className="notice" role="alert">
              <span>{notice}</span>
              <button
                type="button"
                className="icon-button"
                aria-label="关闭提示"
                onClick={() => setNotice("")}
              >
                <X size={15} />
              </button>
            </div>
          )}
          {historyOpen ? (
            <section className="panel history-panel" aria-labelledby="history-title">
              <div className="panel-heading">
                <h1 id="history-title">历史问题</h1>
                <button type="button" className="text-button" onClick={() => setHistoryOpen(false)}>返回{session ? "当前提问" : "首页"}</button>
              </div>
              <p className="panel-description">当前浏览器最近 24 小时的提问，按时间从新到旧排列。点击可查看回答或继续提问。</p>
              {busy && <p role="status">{busy}…</p>}
              {!busy && !historyLoaded && <button type="button" className="text-button" onClick={openHistory}>重新加载</button>}
              {historyLoaded && history.length === 0 && <p className="history-empty">还没有历史问题，开启一次新提问吧。</p>}
              {historyLoaded && <div className="history-list">{history.map((item) => (
                <div className="history-row" key={item.session_id}>
                <button type="button" className="history-entry" disabled={Boolean(busy)} onClick={() => openSession(item.session_id)}>
                  <strong>{item.original_question}</strong>
                  <span><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString("zh-CN")}</time><span>{stageLabels[item.stage]}{item.session_id === sessionId ? " · 当前" : ""}</span></span>
                </button>
                <button type="button" className="history-delete" disabled={Boolean(busy) || restoring}
                  aria-label={"删除历史问题：" + item.original_question} title="删除记录"
                  onClick={() => removeHistory(item.session_id)}>
                  <Trash2 size={16} aria-hidden="true" />
                </button>
                </div>
              ))}</div>}
            </section>
          ) : !session ? (
            <section
              className={homeStyles.landing}
              aria-labelledby="landing-title"
            >
              <span className={homeStyles.orbitOne} aria-hidden="true" />
              <span className={homeStyles.orbitTwo} aria-hidden="true" />

              <div className={homeStyles.hero}>
                <h1 id="landing-title">
                  你好，<em>这里是问山。</em>
                </h1>
                <p className={homeStyles.lead}>多问一句，答案更近一步。</p>
                <p className={homeStyles.supportingCopy}>
                  说说你的问题和处境，一起找到适合你的知乎经验。
                </p>
              </div>

              <nav className={homeStyles.entries} aria-label="其他入口">
                {productEntries.map((entry) => {
                  const Icon = entry.icon;
                  const descriptionId = `${entry.href.slice(1)}-preview-description`;

                  return (
                    <div className={homeStyles.entryWrap} key={entry.href}>
                      <span
                        className={homeStyles.entryBubble}
                        aria-hidden="true"
                      >
                        <span className={homeStyles.entryBubbleIcon}>
                          <Icon size={25} strokeWidth={1.7} />
                        </span>
                        <span className={homeStyles.entryBubbleEyebrow}>
                          {entry.eyebrow}
                        </span>
                        <strong>{entry.title}</strong>
                        <small>{entry.description}</small>
                      </span>
                      <Link
                        href={entry.href}
                        className={homeStyles.entryLink}
                        aria-describedby={descriptionId}
                      >
                        <span>
                          <Icon size={17} aria-hidden="true" />
                          {entry.title}
                        </span>
                        <ArrowRight size={15} aria-hidden="true" />
                      </Link>
                      <span className="sr-only" id={descriptionId}>
                        {entry.description}
                      </span>
                    </div>
                  );
                })}
              </nav>

              <form
                className={`${homeStyles.composer} ${question.length > 2000 ? homeStyles.invalid : ""}`}
                onSubmit={(event) => {
                  event.preventDefault();
                  startQuestion();
                }}
              >
                <label className="sr-only" htmlFor="question">
                  你想了解什么？
                </label>
                <textarea
                  id="question"
                  ref={questionInput}
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="想问什么？例如：要不要从大公司去创业公司？"
                  disabled={Boolean(busy) || restoring}
                  onKeyDown={(event) => {
                    if (
                      (event.ctrlKey || event.metaKey) &&
                      event.key === "Enter"
                    ) {
                      event.preventDefault();
                      startQuestion();
                    }
                  }}
                />
                <div className={homeStyles.composerBar}>
                  <span
                    className={homeStyles.mode}
                    title="信息不足时问山会先追问，再回答"
                  >
                    <Sparkles size={13} aria-hidden="true" />
                    智能追问
                  </span>
                  {question.length > 2000 && (
                    <span className={homeStyles.error}>
                      最多 2,000 字，请缩短
                    </span>
                  )}
                  {question.length > 1800 && question.length <= 2000 && (
                    <span className={homeStyles.count}>
                      {2000 - question.length}
                    </span>
                  )}
                  <button
                    className={homeStyles.send}
                    type="submit"
                    aria-label="发送问题"
                    disabled={
                      Boolean(busy) ||
                      restoring ||
                      !question.trim() ||
                      question.length > 2000
                    }
                  >
                    {busy || restoring ? (
                      <LoaderCircle size={18} className="spin" />
                    ) : (
                      <ArrowUp size={18} strokeWidth={2.2} />
                    )}
                  </button>
                </div>
              </form>

              {busy && (
                <p className={homeStyles.loading} role="status">
                  <LoaderCircle className="spin" size={15} />
                  {busy}…
                </p>
              )}

              <section
                className={homeStyles.questionShelf}
                aria-labelledby="question-shelf-title"
              >
                <div className={homeStyles.shelfHeading}>
                  <div>

                    <h2 id="question-shelf-title">还没想好？试试这些问题</h2>
                  </div>

                </div>
                <div className={homeStyles.questionCards}>
                  {examples.map((example) => {
                    const Icon = example.icon;
                    return (
                      <button
                        className={homeStyles.questionCard}
                        type="button"
                        key={example.category}
                        disabled={Boolean(busy) || restoring}
                        aria-label={`使用问题：${example.text}`}
                        onClick={() => {
                          setQuestion(example.text);
                          questionInput.current?.focus();
                        }}
                      >
                        <span className={homeStyles.cardTop}>
                          <span className={homeStyles.cardCategory}>
                            <Icon size={16} aria-hidden="true" />
                            {example.category}
                          </span>

                        </span>
                        <strong>{example.lines[0]}<br />{example.lines[1]}</strong>
                        <small>{example.hint}</small>
                        <span className={homeStyles.cardAction}>

                          <ArrowRight size={15} aria-hidden="true" />
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            </section>
          ) : (
            <>
              <div className="user-message">
                <span className="user-label">你的问题</span>
                <h1>{session.original_question}</h1>
              </div>
              {session.provider === "demo" && (
                <div className="demo-note">
                  <Sparkles size={14} />
                  当前为演示模式，回答仅展示一般性分析框架。
                </div>
              )}
              {historyAnswer ? null : session.stage === "clarifying" && session.clarification ? (
                <section className="panel clarification-panel">
                  <div className="panel-heading">
                    <span className="assistant-mark">
                      <Mountain size={21} />
                    </span>
                    <span className="eyebrow">问山想再了解一点</span>
                    <span className="round-count">
                      第 {session.clarification_count + 1} / {MAX_CLARIFICATION_ROUNDS} 轮
                    </span>
                  </div>
                  <h2>{session.clarification.title}</h2>
                  <p className="panel-description">
                    {session.clarification.description}
                  </p>
                  {session.clarification.kind === "contextual" ? (
                    Boolean(session.clarification.options?.length) && (
                      <fieldset disabled={Boolean(busy)}>
                        <legend className="field-hint">选择符合你的情况的选项（<em className="hint-accent">{session.clarification.selection_mode === "multiple" ? "可多选" : "单选"}</em>），也可以自由补充</legend>
                        <div className="chips">
                          {session.clarification.options?.map((option) => (
                            <button type="button" key={option}
                              className={`chip ${clarificationAnswers.includes(option) ? "selected" : ""}`}
                              aria-pressed={clarificationAnswers.includes(option)}
                              onClick={() => setClarificationAnswers((answers) => answers.includes(option)
                                ? answers.filter((answer) => answer !== option)
                                : session.clarification?.selection_mode === "multiple" ? [...answers, option] : [option])}>
                              {clarificationAnswers.includes(option) && <Check size={13} />}
                              {option}
                            </button>
                          ))}
                        </div>
                      </fieldset>
                    )
                  ) : (
                    <ContextFields value={context} onChange={setContext}
                      fields={session.clarification.fields} disabled={Boolean(busy)} />
                  )}
                  <label className="field-label supplement">
                    也可以直接说说你的想法<span className="muted">选填</span>
                    <textarea
                      value={freeText}
                      onChange={(event) => setFreeText(event.target.value)}
                      disabled={Boolean(busy)}
                      maxLength={2000}
                      placeholder={session.clarification.placeholder || "不在选项里？在这里自由补充…"}
                    />
                  </label>
                  <div className="panel-actions">
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => submitClarification(true)}
                      disabled={Boolean(busy)}
                    >
                      跳过，直接回答
                      <ArrowRight size={15} />
                    </button>
                    <button
                      type="button"
                      className="primary"
                      onClick={() => submitClarification(false)}
                      disabled={Boolean(busy) || (session.clarification.kind === "contextual" && !clarificationAnswers.length && !freeText.trim())}
                    >
                      {busy ? (
                        <LoaderCircle className="spin" size={16} />
                      ) : (
                        "继续"
                      )}
                      <ArrowRight size={16} />
                    </button>
                  </div>
                  {busy && <p className="loading-caption" role="status">{busy}…</p>}
                </section>
              ) : session.stage === "ready" ? (
                <section className="panel ready-panel">
                  <span className="assistant-mark">
                    <Check size={22} />
                  </span>
                  <h2>这一次，我们聚焦在这里</h2>
                  <ContextTags context={session.confirmed_context} />
                  <p className="focused-question">{session.focused_question}</p>
                  <div className="panel-actions">
                    <button
                      className="primary"
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() =>
                        void run("正在开始分析", (ticket) =>
                          generate(session, ticket),
                        )
                      }
                    >
                      开始分析
                      <ArrowRight size={16} />
                    </button>
                  </div>
                </section>
              ) : isWorking ? (
                <section className="panel progress-panel">
                  <span className="progress-orbit">
                    <Mountain size={31} />
                  </span>
                  <h2 aria-live="polite">
                    {connectionLost
                      ? "连接暂时中断"
                      : session.stage === "searching"
                        ? "正在寻找与你相关的内容"
                        : "正在整理答案中的线索"}
                  </h2>
                  <p>
                    {connectionLost
                      ? "已保留本次请求，重新连接只会检查状态。"
                      : session.provider === "demo"
                        ? "正在根据你确认的条件组织演示回答。"
                        : "好的答案需要一点时间，我们正在核对资料与引用。"}
                  </p>
                  <ContextTags context={session.confirmed_context} />
                  <SearchProgress
                    key={`${session.session_id}:${session.context_version}`}
                    searching={session.stage === "searching"}
                    disconnected={connectionLost}
                  />
                  {connectionLost ? (
                    <button
                      type="button"
                      className="primary"
                      onClick={() => {
                        setConnectionLost(false);
                        setReconnect((value) => value + 1);
                      }}
                    >
                      重新连接
                      <RotateCcw size={16} />
                    </button>
                  ) : null}
                </section>
              ) : session.stage === "error" ? (
                <section className="panel error-panel" role="alert">
                  <RotateCcw size={28} />
                  <h2>这次没能完成回答</h2>
                  <p>{session.error?.message || "你可以稍后手动重试。"}</p>
                  <div className="panel-actions">
                    <button
                      className="primary"
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() =>
                        void run("正在重试", (ticket) =>
                          generate(session, ticket),
                        )
                      }
                    >
                      手动重试
                      <RotateCcw size={15} />
                    </button>
                  </div>
                </section>
              ) : null}
              {displayedAnswer && (
                <div id="history-post-results">
                <AnswerCard
                  key={displayedAnswer.id}
                  answer={displayedAnswer}
                  clarificationHistory={displayedAnswer.clarification_history ?? session.clarification_history}
                  busy={Boolean(busy)}
                  onEditCondition={editCondition}
                  onLoadChoices={loadRevisionChoices}
                  stale={displayedAnswer.context_version !== session.context_version}
                  onFeedback={feedback}
                />
                {historyAnswer && historyAnswer.context_version !== session.context_version && (
                  <button type="button" className="text-button" onClick={() => setHistoryResult(null)}>
                    返回当前条件，继续提问
                  </button>
                )}
                </div>
              )}
              {oldAnswers.length > 0 && (
                <details className="previous-answers">
                  <summary>
                    此前条件下的回答 <span>{oldAnswers.length}</span>
                  </summary>
                  {oldAnswers.toReversed().map((answer) => (
                    <AnswerCard
                      key={answer.id}
                      answer={answer}
                      stale
                      onFeedback={feedback}
                    />
                  ))}
                </details>
              )}
              {busy && (
                <p className="loading-caption" role="status">
                  <LoaderCircle className="spin" size={15} />
                  {busy}…
                </p>
              )}
            </>
          )}
          </main>
        </div>
      </div>
      {showClarificationProgress && (
        <WaveProgressFloat
          // The actual end of clarification fills the orb, even on an early exit.
          value={finishingClarification ? 100 : (clarificationRound / (MAX_CLARIFICATION_ROUNDS + 1)) * 100}
          size={80}
          label={finishingClarification ? "追问已完成" : `追问第 ${clarificationRound} 轮，最多 ${MAX_CLARIFICATION_ROUNDS} 轮`}
          className="clarification-progress-float"
        />
      )}
      <dialog
        ref={deleteDialog}
        className="about-dialog delete-dialog"
        aria-labelledby="delete-history-title"
        aria-describedby="delete-history-description"
        onClose={() => setDeleteTarget(null)}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          if (event.clientX < bounds.left || event.clientX > bounds.right ||
              event.clientY < bounds.top || event.clientY > bounds.bottom) cancelDelete();
        }}
      >
        <button type="button" className="icon-button dialog-close" aria-label="关闭删除确认" onClick={cancelDelete}>
          <X size={20} />
        </button>
        <span className="brand-icon"><Mountain size={28} aria-hidden="true" /></span>
        <h2 id="delete-history-title">确认删除这条历史记录？</h2>
        <p id="delete-history-description">删除后，该问题和已生成的帖子结果将无法恢复。</p>
        <div className="delete-question">{deleteTarget?.original_question}</div>
        <div className="delete-dialog-actions">
          <button autoFocus type="button" className="delete-cancel" onClick={cancelDelete}>取消</button>
          <button type="button" className="primary" onClick={confirmDelete} disabled={Boolean(busy) || !deleteTarget}>
            <Trash2 size={16} aria-hidden="true" />确认删除
          </button>
        </div>
      </dialog>
      {about && (
        <div
          className="modal-backdrop"
          onKeyDown={dialogKeys}
          onClick={(event) => {
            if (event.target === event.currentTarget) setAbout(false);
          }}
        >
          <section
            className="about-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="about-title"
          >
            <button
              autoFocus
              className="icon-button dialog-close"
              type="button"
              aria-label="关闭关于问山"
              onClick={() => setAbout(false)}
            >
              <X size={20} />
            </button>
            <span className="brand-icon">
              <Mountain size={28} />
            </span>
            <h2 id="about-title">多问一句，答案更近一步。</h2>
            <p>
              问山根据你的具体问题和补充，判断还需要了解什么。最多追问 {MAX_CLARIFICATION_ROUNDS} 轮，信息足够就开始回答，也可以随时跳过。
            </p>
            <p>
              连接真实资料后，每次回答会展示可检查的来源。演示模式仅展示交互与一般性分析框架。
            </p>
            <div className="about-privacy">
              <ShieldCheck size={19} />
              <p>
                无需登录。匿名会话保留 24
                小时用于刷新恢复，到期清理。开始新提问时，不会复用此前条件。
              </p>
            </div>
            <button
              className="primary"
              type="button"
              onClick={() => setAbout(false)}
            >
              继续探索
              <ArrowRight size={16} />
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
