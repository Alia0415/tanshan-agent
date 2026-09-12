"use client";

import { WaveProgress } from "./wave-progress";
import styles from "./wave-progress-float.module.css";

export type WaveProgressFloatProps = {
  value: number;
  size?: number;
  label?: string;
  caption?: string;
  position?: "bottom-right" | "bottom-left";
  className?: string;
};

export function WaveProgressFloat({
  value,
  size = 104,
  label = "问山澄清进度",
  caption = "正在了解你的关注点",
  position = "bottom-right",
  className = "",
}: WaveProgressFloatProps) {
  const progress = Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : 0;

  return (
    <aside
      className={`${styles.float} ${styles[position]} ${className}`.trim()}
      aria-live="polite"
      aria-label={label}
    >
      <div className={styles.progressLabel}>
        <span>{caption}</span>
        <strong>{Math.round(progress)}%</strong>
      </div>
      <WaveProgress value={progress} size={size} label={label} />
    </aside>
  );
}
