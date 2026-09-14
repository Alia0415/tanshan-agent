"use client";

import { CircleAlert, LoaderCircle, Sparkles, Users, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import styles from "./resonance-globe-overlay.module.css";

const ResonanceGlobeCanvas = dynamic(
  () =>
    import("./resonance-globe-canvas").then(
      (module) => module.ResonanceGlobeCanvas,
    ),
  { ssr: false },
);

export type ResonanceGlobeOverlayProps = {
  open: boolean;
  sourceTitle: string;
  sourceAuthor: string;
  count: number | null;
  loading: boolean;
  error: string;
  onClose: () => void;
};

export function ResonanceGlobeOverlay({
  open,
  sourceTitle,
  sourceAuthor,
  count,
  loading,
  error,
  onClose,
}: ResonanceGlobeOverlayProps) {
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        closeButtonRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [onClose, open]);

  if (!open || typeof document === "undefined") return null;

  const safeCount = count === null ? null : Math.max(0, Math.round(count));
  const author = sourceAuthor.trim() || "知乎用户";
  const heading = loading
    ? "连接正在发生"
    : error
      ? "连接暂未完成"
      : "连接已经发生";
  const eyebrow = loading
    ? "这段经历，正在寻找共鸣"
    : error
      ? "这段经历，等待再次连接"
      : "这段经历，正在被看见";

  return createPortal(
    <section
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className={styles.backgroundOrbit} aria-hidden="true" />

      <header className={styles.header}>
        <button
          ref={closeButtonRef}
          className={styles.closeButton}
          type="button"
          onClick={onClose}
          aria-label="关闭共鸣地球"
        >
          <X size={20} />
        </button>
      </header>

      <div className={styles.intro}>
        <span className={styles.eyebrow}>
          <Sparkles size={15} />
          {eyebrow}
        </span>
        <h2 id={titleId}>{heading}</h2>
        <p>
          {error
            ? "网络暂时没有回应，关闭后可以再次尝试"
            : "世界上，还有人也停在了这个问题前"}
        </p>
      </div>

      <div className={styles.visualStage}>
        <ResonanceGlobeCanvas
          className={styles.globeWrap}
          connectionCount={safeCount}
          active={open}
        />

        <aside className={`${styles.floatingCard} ${styles.countCard}`}>
          <span className={styles.cardIcon}>
            {loading ? (
              <LoaderCircle className={styles.spinner} size={18} />
            ) : error ? (
              <CircleAlert size={18} />
            ) : (
              <Users size={18} />
            )}
          </span>
          <div>
            <small>{loading ? "正在寻找共鸣" : error ? "连接未完成" : "共同停留"}</small>
            {loading ? (
              <strong>正在连接节点…</strong>
            ) : error ? (
              <strong>人数暂未同步</strong>
            ) : safeCount === null ? (
              <strong>新的连接正在形成</strong>
            ) : safeCount <= 1 ? (
              <strong>你点亮了第一个节点</strong>
            ) : (
              <strong><b>{safeCount}</b> 人已连接这段经历</strong>
            )}
          </div>
        </aside>

        <aside className={`${styles.floatingCard} ${styles.sourceCard}`}>
          <span className={styles.cardPill}>来自知乎</span>
          <strong title={sourceTitle}>{sourceTitle}</strong>
          <small>作者 · {author}</small>
        </aside>

        <aside className={`${styles.floatingCard} ${styles.meaningCard}`}>
          <span className={styles.liveDot} />
          <div>
            <small>{error ? "此次连接" : loading ? "正在建立连接" : "此刻的连接"}</small>
            <strong>
              {error
                ? "暂时没有完成"
                : loading
                  ? "蓝色轨迹正在寻找共鸣节点"
                  : "因为同一个问题而亮起"}
            </strong>
          </div>
        </aside>
      </div>

      {error ? (
        <p className={styles.errorMessage} role="alert">
          共鸣人数暂时无法获取：{error}
        </p>
      ) : null}

      <p className={styles.privacyNote}>
        光点呈现问题与内容的匿名共鸣轨迹，不代表真实位置或个人身份
      </p>
    </section>,
    document.body,
  );
}
