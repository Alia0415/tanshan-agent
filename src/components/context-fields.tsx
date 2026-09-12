"use client";

import { Check } from "lucide-react";
import { PURPOSES, type Context, type Purpose } from "@/lib/domain/types";

export const prioritiesFor = (purpose?: Purpose) =>
  purpose === "campus"
    ? ["住宿条件", "校园生活", "交通出行", "学习体验"]
    : purpose === "postgraduate"
      ? ["科研环境", "就业发展", "学习体验", "报考难度"]
      : ["就业发展", "学习体验", "科研环境", "报考难度", "校园生活"];

export function ContextFields({
  value,
  onChange,
  fields,
  disabled = false,
}: {
  value: Context;
  onChange: (next: Context) => void;
  fields: string[];
  disabled?: boolean;
}) {
  const priorities = [
    ...new Set([...prioritiesFor(value.purpose), ...value.priorities]),
  ];
  return (
    <div className="context-fields">
      {fields.includes("school") && (
        <label className="field-label">
          学校
          <input
            value={value.school || ""}
            onChange={(e) => onChange({ ...value, school: e.target.value })}
            placeholder="学校名称，也可以暂不填写"
            maxLength={100}
            disabled={disabled}
          />
        </label>
      )}
      {fields.includes("purpose") && (
        <fieldset disabled={disabled}>
          <legend>这次了解的目的</legend>
          <div className="purpose-grid">
            {Object.entries(PURPOSES).map(([key, label], index) => (
              <button
                key={key}
                type="button"
                className={`choice purpose-choice ${value.purpose === key ? "selected" : ""}`}
                aria-pressed={value.purpose === key}
                onClick={() => onChange({ ...value, purpose: key as Purpose })}
              >
                <span className="option-number">0{index + 1}</span>
                <span>
                  {label}
                  <small>
                    {
                      [
                        "为下一段学习旅程做准备",
                        "找到适合自己的研究方向",
                        "看看在这里生活的样子",
                        "先建立一个整体印象",
                      ][index]
                    }
                  </small>
                </span>
                <span className="choice-check">
                  {value.purpose === key && <Check size={14} />}
                </span>
              </button>
            ))}
          </div>
        </fieldset>
      )}
      {fields.includes("major") && (
        <label className="field-label">
          意向专业<span className="muted">选填</span>
          <input
            value={value.major || ""}
            onChange={(e) => onChange({ ...value, major: e.target.value })}
            list="major-options"
            placeholder="例如：计算机，或尚未确定"
            maxLength={100}
            disabled={disabled}
          />
          <datalist id="major-options">
            <option value="计算机" />
            <option value="医学" />
            <option value="经管" />
            <option value="尚未确定" />
          </datalist>
        </label>
      )}
      {fields.includes("priorities") && (
        <fieldset disabled={disabled}>
          <legend>
            关注重点{" "}
            <span className="muted">{value.priorities.length} / 2</span>
          </legend>
          <div className="chips">
            {priorities.map((priority) => {
              const selected = value.priorities.includes(priority);
              return (
                <button
                  type="button"
                  className={`chip ${selected ? "selected" : ""}`}
                  key={priority}
                  aria-pressed={selected}
                  disabled={!selected && value.priorities.length >= 2}
                  onClick={() =>
                    onChange({
                      ...value,
                      priorities: selected
                        ? value.priorities.filter((item) => item !== priority)
                        : [...value.priorities, priority],
                    })
                  }
                >
                  {selected && <Check size={13} />}
                  {priority}
                </button>
              );
            })}
          </div>
          <p className="field-hint">最多选择两项，帮助答案更聚焦。</p>
        </fieldset>
      )}
      {fields.includes("campus") && (
        <label className="field-label">
          校区<span className="muted">选填</span>
          <input
            value={value.campus || ""}
            onChange={(e) => onChange({ ...value, campus: e.target.value })}
            placeholder="不确定可以留空"
            maxLength={100}
            disabled={disabled}
          />
        </label>
      )}
      {fields.includes("province") && value.purpose === "undergraduate" && (
        <div className="two-fields">
          <label className="field-label">
            高考省份<span className="muted">选填</span>
            <input
              value={value.province || ""}
              onChange={(e) => onChange({ ...value, province: e.target.value })}
              maxLength={100}
              disabled={disabled}
            />
          </label>
          <label className="field-label">
            年份<span className="muted">选填</span>
            <input
              value={value.year || ""}
              onChange={(e) => onChange({ ...value, year: e.target.value })}
              placeholder="例如 2026"
              maxLength={4}
              inputMode="numeric"
              disabled={disabled}
            />
          </label>
        </div>
      )}
    </div>
  );
}

export function ContextTags({ context }: { context: Context }) {
  return (
    <div className="tags">
      {[
        context.school,
        context.purpose && PURPOSES[context.purpose],
        context.major,
        ...context.priorities,
        context.campus,
        context.province,
        context.year,
      ]
        .filter(Boolean)
        .map((label, index) => (
          <span key={`${label}-${index}`}>{label}</span>
        ))}
    </div>
  );
}
