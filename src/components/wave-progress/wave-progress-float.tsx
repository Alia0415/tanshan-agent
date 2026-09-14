"use client";

import { WaveProgress } from "./wave-progress";
import styles from "./wave-progress-float.module.css";

export type WaveProgressFloatProps = {
  value: number;
  size?: number;
  label?: string;
  position?: "bottom-right" | "bottom-left";
  className?: string;
};

export function WaveProgressFloat({
  value,
  size = 104,
  label = "探山澄清进度",
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
      <WaveProgress value={progress} size={size} label={label} />
    </aside>
  );
}
