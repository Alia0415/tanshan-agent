import type { CSSProperties } from "react";
import styles from "./percentage-progress.module.css";

export function PercentageProgress({ value, label, className = "", style }: { value: number; label: string; className?: string; style?: CSSProperties }) {
  const percent = Math.round(Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0);
  return <div className={`${styles.root} ${className}`} style={style}>
    <div className={styles.heading}><span>{label}</span><strong>{percent}%</strong></div>
    <div className={styles.track} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${percent}%，${label}`}><span style={{ width: `${percent}%` }} /></div>
  </div>;
}
