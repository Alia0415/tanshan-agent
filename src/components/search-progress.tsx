"use client";

import { useEffect, useState } from "react";
import { Check, Mountain } from "lucide-react";

export function SearchProgress({ searching, disconnected }: { searching: boolean; disconnected: boolean }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const current = searching ? 0 : 1;
  const caption = disconnected
    ? "小山暂时收不到消息了，重新连接后继续查看进展。"
    : elapsed >= 120
      ? "这次比平时久一些，仍在处理中，请再稍等。"
      : elapsed >= 45
        ? "线索还在整理中，谢谢你多给小山一点时间。"
        : searching
          ? "小山正在翻找线索，帮你把相关的内容带回来。"
          : "线索正在汇成答案，再给小山一点时间。";

  return (
    <div className={`search-progress${disconnected ? " is-paused" : ""}`}>
      <div className="search-progress-meta">
        <span>{disconnected ? "等待重新连接" : "小山正在努力中"}</span>
        <span role="timer" aria-live="off">本次已等待 {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</span>
      </div>
      <div className="search-progress-track" role="progressbar" aria-label={disconnected ? "连接中断，进度未知" : searching ? "正在寻找资料" : "正在整理答案"}>
        <span />
      </div>
      <ol className="search-progress-steps" aria-label="回答处理阶段">
        {["寻找资料", "整理答案", "完成"].map((label, index) => (
          <li key={label} className={index < current ? "is-done" : index === current ? "is-current" : ""} aria-current={index === current ? "step" : undefined}>
            <span>{index < current ? <Check size={12} /> : index === current ? <Mountain size={13} /> : index + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      <p className="search-progress-caption" role="status">{caption}</p>
    </div>
  );
}
