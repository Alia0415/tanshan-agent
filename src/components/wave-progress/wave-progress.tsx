"use client";

import type { CSSProperties } from "react";
import styles from "./wave-progress.module.css";

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
          <path d="M0 32C80 0 80 0 160 32S240 64 320 32C400 0 400 0 480 32S560 64 640 32V360H0Z" />
        </svg>
        <svg
          className={`${styles.wave} ${styles.frontWave}`}
          viewBox="0 0 640 360"
          preserveAspectRatio="none"
        >
          <path d="M0 30C64 62 96 62 160 30S256-2 320 30C384 62 416 62 480 30S576-2 640 30V360H0Z" />
        </svg>
        <span className={styles.liquidShine} />
      </div>
      <span className={styles.orbHighlight} aria-hidden="true" />
    </div>
  );
}
