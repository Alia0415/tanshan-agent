"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Mountain, Sparkles, X } from "lucide-react";

type Step = {
  eyebrow: string;
  title: string;
  lines: string[];
  art: "welcome" | "chat" | "book" | "roundtable";
};

const STEPS: Step[] = [
  {
    eyebrow: "为什么是问山",
    title: "回答多而杂，答案不好找？",
    lines: [
      "知乎话题下的回复常常多而杂，难以快速找到自己想要的答案。",
      "问山会追问你的背景，帮你找答案、理思路；",
      "也把回答之间的争论拆分出来，用多个 Agent 代表不同观点派系，帮你找到争论点，打破信息茧房。",
    ],
    art: "welcome",
  },
  {
    eyebrow: "第一站 · Agent 问答",
    title: "几轮追问，把模糊的问题变具体",
    lines: [
      "进入问山，第一眼看到的就是它。",
      "通过几轮追问补充你的背景，把原本模糊的问题变成具体的问题，",
      "从而找到更适合你情况的答案。",
    ],
    art: "chat",
  },
  {
    eyebrow: "第二站 · 阅读助手",
    title: "把话题拆开，观点分类呈现",
    lines: [
      "把你想要阅读的话题拆解成不同的侧重点与立场，",
      "并对收集到的观点进行分类，",
      "辅助你快速理解这个话题下的内容。",
    ],
    art: "book",
  },
  {
    eyebrow: "第三站 · 观点圆桌",
    title: "看不同观点如何交锋",
    lines: [
      "多个 Agent 代表不同观点派系，同场讨论。",
      "不仅帮你快速找到想看的内容，",
      "更展现同一话题下不同观点的争论如何进行，看见共通与分歧。",
    ],
    art: "roundtable",
  },
];

function StepArt({ kind }: { kind: Step["art"] }) {
  if (kind === "chat") {
    return (
      <svg viewBox="0 0 120 76" fill="none" aria-hidden="true">
        <path
          d="M14 16a10 10 0 0 1 10-10h56a10 10 0 0 1 10 10v22a10 10 0 0 1-10 10H42l-14 12V48h-4a10 10 0 0 1-10-10z"
          fill="#edf5ff"
          stroke="#056de8"
          strokeWidth="2"
        />
        <circle cx="38" cy="27" r="3" fill="#056de8" />
        <circle cx="52" cy="27" r="3" fill="#056de8" />
        <circle cx="66" cy="27" r="3" fill="#056de8" />
        <path
          d="M96 24a10 10 0 0 1 10 10v14a10 10 0 0 1-10 10h-2v8l-10-8H74a10 10 0 0 1-10-10V34a10 10 0 0 1 10-10z"
          fill="#056de8"
          opacity="0.9"
        />
        <path d="M76 38h20M76 46h12" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === "book") {
    return (
      <svg viewBox="0 0 120 76" fill="none" aria-hidden="true">
        <path
          d="M60 16C54 10.5 43.5 9.5 35 12.5V42c8.5-3 19-2 25 3"
          fill="#edf5ff"
          stroke="#056de8"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path
          d="M60 16c6-5.5 16.5-6.5 25-3.5V42c-8.5-3-19-2-25 3"
          fill="#fff"
          stroke="#056de8"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path d="M60 15v30" stroke="#056de8" strokeWidth="2" />
        <path
          d="M42 24h12M42 31h12M66 24h12M66 31h12"
          stroke="#9ec7fa"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <path d="M26 60l6-6M94 66l6-6" stroke="#cfe0ff" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === "roundtable") {
    return (
      <svg viewBox="0 0 120 76" fill="none" aria-hidden="true">
        <path
          d="M30 22l16 12M90 22 74 34M30 54l16-10M90 54 74 44"
          stroke="#dbeaff"
          strokeWidth="2"
        />
        <circle cx="60" cy="38" r="12" fill="#edf5ff" stroke="#056de8" strokeWidth="2" />
        <circle cx="24" cy="16" r="8" fill="#056de8" />
        <circle cx="96" cy="16" r="8" fill="#f59e0b" />
        <circle cx="18" cy="56" r="8" fill="#10b981" />
        <circle cx="102" cy="56" r="8" fill="#8b5cf6" />
        <rect x="40" y="2" width="18" height="9" rx="4.5" fill="#056de8" opacity="0.85" />
        <rect x="66" y="65" width="20" height="9" rx="4.5" fill="#10b981" opacity="0.85" />
      </svg>
    );
  }
  return (
    <span className="ob-logo" aria-hidden="true">
      <Mountain size={34} strokeWidth={1.6} />
    </span>
  );
}

export function Onboarding() {
  // 每次进入 Agent 问答页（含刷新）都展示；关闭后本次停留内不再出现
  const [open, setOpen] = useState(true);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish();
      if (event.key === "ArrowRight") setIndex((i) => Math.min(i + 1, STEPS.length - 1));
      if (event.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function finish() {
    setOpen(false);
  }

  if (!open) return null;
  const step = STEPS[index];
  const last = index === STEPS.length - 1;

  return (
    <div className="ob-overlay" role="dialog" aria-modal="true" aria-label="问山新手指引">
      <div className="ob-card">
        <button type="button" className="ob-skip" onClick={finish} aria-label="跳过引导">
          跳过
          <X size={14} aria-hidden="true" />
        </button>

        <div className="ob-brand" aria-hidden="true">
          <Mountain size={16} strokeWidth={1.8} />
          问山 · WENSHAN
        </div>

        <div className="ob-step" key={index}>
          <div className="ob-art">
            <StepArt kind={step.art} />
          </div>
          <span className="ob-eyebrow">{step.eyebrow}</span>
          <h2>{step.title}</h2>
          {step.lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>

        <div className="ob-footer">
          <div className="ob-dots" aria-hidden="true">
            {STEPS.map((item, i) => (
              <span key={item.eyebrow} className={i === index ? "on" : ""} />
            ))}
            <span className="ob-progress" style={{ width: `${((index + 1) / STEPS.length) * 100}%` }} />
          </div>
          <div className="ob-actions">
            {index > 0 ? (
              <button type="button" className="ob-nav" onClick={() => setIndex(index - 1)} aria-label="上一步">
                <ArrowLeft size={16} aria-hidden="true" />
                上一步
              </button>
            ) : (
              <span className="ob-hint">
                <Sparkles size={13} aria-hidden="true" />
                约 30 秒了解问山
              </span>
            )}
            {last ? (
              <button type="button" className="ob-cta" onClick={finish}>
                开始使用
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            ) : (
              <button type="button" className="ob-cta" onClick={() => setIndex(index + 1)}>
                下一步
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
