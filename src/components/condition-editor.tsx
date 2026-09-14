"use client";
import { useEffect, useState } from "react";
import type { ClarificationCard, ClarificationResponse, ClarificationRevision } from "@/lib/domain/types";
type Located = { history_index: number; card: ClarificationCard };
export function ConditionEditor({ label, answerId, sources, history, busy, onSave, onCancel, onLoadChoices }: {
  label: string; answerId: string; sources?: { label: string; history_index: number }[];
  history: ClarificationResponse[]; busy: boolean;
  onLoadChoices?: (label: string, answerId: string) => Promise<Located>;
  onSave: (revision: ClarificationRevision) => void; onCancel: () => void;
}) {
  const sourceIndex = sources?.find((source) => source.label === label)?.history_index;
  const initial = sourceIndex !== undefined && history[sourceIndex]?.card?.options?.length
    ? { history_index: sourceIndex, card: history[sourceIndex].card! } : null;
  const [located, setLocated] = useState<Located | null>(initial);
  const [selected, setSelected] = useState<string[]>(initial ? history[initial.history_index]?.selected || [] : []);
  const [text, setText] = useState(initial ? history[initial.history_index]?.free_text || "" : "");
  const [showOther, setShowOther] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (located || !onLoadChoices) return;
    let active = true;
    onLoadChoices(label, answerId).then((result) => {
      if (!active) return;
      setLocated(result);
      setSelected(history[result.history_index]?.selected || []);
      setText(history[result.history_index]?.free_text || "");
      setError("");
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "选项加载失败，请重试。");
    });
    return () => { active = false; };
  }, [located, onLoadChoices, label, answerId, history, retry]);
  const turn = located ? history[located.history_index] : undefined;
  const value = [...selected, text.trim()].filter(Boolean).join("；");
  return <form className="condition-tag-editor" onSubmit={(event) => {
    event.preventDefault();
    if (located && turn && value && value !== turn.answer && !busy)
      onSave({ history_index: located.history_index, selected, free_text: text.trim() });
  }}>
    <p className="eyebrow">修改「{label}」</p>
    {!located && !error && <p role="status">正在加载这项条件的可选答案…</p>}
    {error && <p className="error-text" role="alert">{error}
      <button type="button" className="text-button" disabled={busy} onClick={() => { setError(""); setRetry((value) => value + 1); }}>重试</button>
    </p>}
    {located && <>
      <fieldset disabled={busy}>
        <legend>{located.card.title}</legend>
        <p className="field-hint">{located.card.selection_mode === "multiple" ? "可多选" : "请选择一项"}</p>
        <div className="chips">{located.card.options?.map((option) => <button
          key={option} type="button" className={"chip " + (selected.includes(option) ? "selected" : "")}
          aria-pressed={selected.includes(option)} onClick={() => setSelected((current) =>
            located.card.selection_mode === "multiple"
              ? current.includes(option) ? current.filter((item) => item !== option) : [...current, option]
              : [option])}>{option}</button>)}</div>
      </fieldset>
      {text && !showOther && <p className="field-hint">已保留补充：{text}
        <button type="button" className="text-button" disabled={busy} onClick={() => setText("")}>移除</button>
      </p>}
      <button type="button" className="text-button" disabled={busy} aria-expanded={showOther}
        onClick={() => setShowOther(!showOther)}>{showOther ? "收起补充" : "其他／补充（选填）"}</button>
      {showOther && <label className="field-label">补充你的需求
        <textarea value={text} maxLength={2000} disabled={busy}
          placeholder={located.card.placeholder || "没有合适的选项时再填写"}
          onChange={(event) => setText(event.target.value)} />
      </label>}
    </>}
    <div className="panel-actions">
      <button type="button" className="text-button" disabled={busy} onClick={onCancel}>取消</button>
      <button type="submit" className="primary small" disabled={busy || !located || !turn || !value || value === turn.answer}>
        {busy ? "正在重新搜索…" : "确认选择并重新搜索"}
      </button>
    </div>
  </form>;
}
