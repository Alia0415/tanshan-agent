"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Droplets,
  Mountain,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { WaveProgress } from "./wave-progress";
import styles from "./wave-progress-demo.module.css";

const QUESTIONS = [
  {
    label: "阅读目的",
    question: "你更想理解这种现象，还是正在考虑自己要不要读博？",
    hint: "确认你为什么来到这个问题",
  },
  {
    label: "所处阶段",
    question: "你现在正处于哪个学习或职业阶段？",
    hint: "找到与你处境相近的真实经历",
  },
  {
    label: "关注方向",
    question: "科研兴趣、就业压力和机会成本，你更关心哪些？",
    hint: "让阅读路线优先回应你的顾虑",
  },
  {
    label: "阅读偏好",
    question: "你想先看相似经历、专业分析，还是相反观点？",
    hint: "决定观点地图的第一条路径",
  },
] as const;

const STEP_SIZE = 100 / QUESTIONS.length;

function nextStop(progress: number) {
  return Math.min(100, (Math.floor(progress / STEP_SIZE) + 1) * STEP_SIZE);
}

function previousStop(progress: number) {
  return Math.max(0, (Math.ceil(progress / STEP_SIZE) - 1) * STEP_SIZE);
}

export function WaveProgressDemo() {
  const [progress, setProgress] = useState(0);
  const completedQuestions = Math.min(
    QUESTIONS.length,
    Math.ceil(progress / STEP_SIZE),
  );
  const activeQuestion =
    completedQuestions === 0 ? null : QUESTIONS[completedQuestions - 1];
  const isComplete = progress === 100;

  function advance() {
    setProgress((current) => (current === 100 ? 0 : nextStop(current)));
  }

  return (
    <main className={styles.page}>
      <div className={styles.ambientOrbOne} aria-hidden="true" />
      <div className={styles.ambientOrbTwo} aria-hidden="true" />

      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="返回探山首页">
          <span className={styles.brandMark}>
            <Mountain size={20} strokeWidth={1.8} />
          </span>
          <span>
            探山 <small>TANSHAN</small>
          </span>
        </Link>
        <span className={styles.prototypeBadge}>
          <span />
          动态澄清原型
        </span>
      </header>

      <div className={styles.content}>
        <section className={styles.copyPanel}>
          <p className={styles.eyebrow}>
            <Sparkles size={14} />
            READING MAP · 生成前的轻量澄清
          </p>
          <h1>
            每多问一句，
            <br />
            <span>离答案更近一点。</span>
          </h1>
          <p className={styles.intro}>
            水位代表探山对你阅读意图的理解程度。每输出一个问题，水波就会上升一格；信息足够时，整颗圆会被逐渐填满。
          </p>

          <div className={styles.questionCard} aria-live="polite">
            <div className={styles.questionMeta}>
              <span>
                {isComplete
                  ? "READY"
                  : activeQuestion
                    ? `QUESTION ${completedQuestions}`
                    : "START"}
              </span>
              <span>
                {completedQuestions} / {QUESTIONS.length}
              </span>
            </div>
            {isComplete ? (
              <>
                <h2>已经足够了解你的关注点</h2>
                <p>接下来可以生成属于你的个性化观点地图。</p>
              </>
            ) : activeQuestion ? (
              <>
                <span className={styles.questionLabel}>
                  {activeQuestion.label}
                </span>
                <h2>{activeQuestion.question}</h2>
                <p>{activeQuestion.hint}</p>
              </>
            ) : (
              <>
                <h2>准备生成你的阅读地图</h2>
                <p>点击下方按钮，观察问题出现时水位如何逐步升高。</p>
              </>
            )}
          </div>

          <div className={styles.actions}>
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={() => setProgress((current) => previousStop(current))}
              disabled={progress === 0}
            >
              <ArrowLeft size={17} />
              回退
            </button>
            <button
              className={styles.primaryButton}
              type="button"
              onClick={advance}
            >
              {isComplete ? (
                <>
                  <RotateCcw size={17} />
                  重新演示
                </>
              ) : (
                <>
                  输出下一个问题
                  <ArrowRight size={17} />
                </>
              )}
            </button>
          </div>

          <label className={styles.scrubber}>
            <span>
              手动检查水位
              <output>{Math.round(progress)}%</output>
            </span>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={progress}
              onChange={(event) => setProgress(Number(event.target.value))}
              aria-label="调整水波进度"
            />
          </label>
        </section>

        <section className={styles.visualPanel} aria-label="水波进度预览">
          <div className={styles.visualHeading}>
            <span>
              <Droplets size={15} />
              INTENT LEVEL
            </span>
            <strong>{Math.round(progress)}%</strong>
          </div>

          <div className={styles.orbStage}>
            <div className={styles.orbHalo} aria-hidden="true" />
            <WaveProgress value={progress} />
          </div>

          <ol className={styles.stepList} aria-label="澄清步骤">
            {QUESTIONS.map((question, index) => {
              const reached = progress >= (index + 1) * STEP_SIZE;
              const current =
                !isComplete && completedQuestions === index + 1;
              return (
                <li
                  key={question.label}
                  className={`${reached ? styles.reached : ""} ${current ? styles.current : ""}`}
                >
                  <button
                    type="button"
                    onClick={() => setProgress((index + 1) * STEP_SIZE)}
                    aria-label={`跳到${question.label}，进度 ${(index + 1) * STEP_SIZE}%`}
                  >
                    <span>{reached ? <Check size={12} /> : index + 1}</span>
                    {question.label}
                  </button>
                </li>
              );
            })}
          </ol>

          <p className={styles.visualCaption}>
            水波会持续流动，水位只随业务进度变化。
            <br />
            支持任意百分比，不受问题数量限制。
          </p>
        </section>
      </div>
    </main>
  );
}
