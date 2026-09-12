"use client";

import { useId, type CSSProperties } from "react";
import styles from "./wave-progress.module.css";

const FRONT_WAVE_PATH =
  "M0 30C64 62 96 62 160 30S256-2 320 30C384 62 416 62 480 30S576-2 640 30V360H0Z";

export type WaveProgressProps = {
  /** 当前进度。组件会自动将数值限制在 0～100。 */
  value: number;
  /** 圆球尺寸。数字按 px 处理，也可传 CSS 尺寸字符串。 */
  size?: number | string;
  /** 提供给屏幕阅读器的进度名称。 */
  label?: string;
  className?: string;
  style?: CSSProperties;
};

export function WaveProgress({
  value,
  size = "100%",
  label = "问山澄清进度",
  className = "",
  style,
}: WaveProgressProps) {
  const highlightId = `wave-highlight-${useId().replaceAll(":", "")}`;
  const progress = Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : 0;
  const resolvedSize = typeof size === "number" ? `${size}px` : size;

  return (
    <div
      className={`${styles.orb} ${className}`.trim()}
      style={{ width: resolvedSize, height: resolvedSize, ...style }}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress)}
      aria-valuetext={`已完成 ${Math.round(progress)}%`}
    >
      <div
        className={styles.liquid}
        style={{
          height: `${progress}%`,
          opacity: progress === 0 ? 0 : 1,
        }}
        aria-hidden="true"
      >
        <svg
          className={`${styles.wave} ${styles.backWave}`}
          viewBox="0 0 640 360"
          preserveAspectRatio="none"
        >
          <path
            className={styles.waveBody}
            d="M0 32C80 0 80 0 160 32S240 64 320 32C400 0 400 0 480 32S560 64 640 32V360H0Z"
          />
        </svg>
        <svg
          className={`${styles.wave} ${styles.frontWave}`}
          viewBox="0 0 640 360"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient
              id={highlightId}
              gradientUnits="userSpaceOnUse"
              x1="0"
              y1="0"
              x2="320"
              y2="0"
              spreadMethod="repeat"
            >
              <stop offset="0" stopColor="#fff" stopOpacity="0" />
              <stop offset="0.28" stopColor="#fff" stopOpacity="0.025" />
              <stop offset="0.58" stopColor="#fff" stopOpacity="0.2" />
              <stop offset="0.8" stopColor="#fff" stopOpacity="0.07" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path className={styles.waveBody} d={FRONT_WAVE_PATH} />
          <path
            className={styles.waveHighlight}
            d={FRONT_WAVE_PATH}
            fill={`url(#${highlightId})`}
          />
        </svg>
      </div>
      <span className={styles.orbHighlight} aria-hidden="true" />
    </div>
  );
}
