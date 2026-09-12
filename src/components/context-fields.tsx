"use client";
import { Check } from "lucide-react";
import { PURPOSES, type Context, type Purpose } from "@/lib/domain/types";

export const prioritiesFor = () => [
  "成本与投入",
  "时间与效率",
  "风险与可靠性",
  "难度与门槛",
  "实际体验",
  "长期影响",
];
const textFields = {
  topic: {
    label: "讨论对象",
    placeholder: "例如：换工作、周末旅行、某款产品",
    max: 100,
  },
  scenario: {
    label: "场景或背景",
    placeholder: "例如：工作三年，想换一个行业；或周末带家人出行",
    max: 500,
  },
  constraints: {
    label: "限制条件",
    placeholder: "例如：预算、时间、地点，或不想接受的方案",
    max: 500,
  },
} as const;

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
  const priorities = [...new Set([...prioritiesFor(), ...value.priorities])];
  return (
    <div className="context-fields">
      {fields.includes("purpose") && (
        <fieldset disabled={disabled}>
          <legend>这次提问的目的</legend>
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
                        "了解事实、观点和不同经历",
                        "弄清差异，找到合适的选择",
                        "梳理原因，找到可行的做法",
                        "先给我一个整体回答",
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
      {Object.entries(textFields).map(
        ([key, config]) =>
          fields.includes(key) && (
            <label className="field-label" key={key}>
              {config.label}
              <span className="muted">选填</span>
              <input
                value={value[key as keyof typeof textFields] || ""}
                onChange={(e) => onChange({ ...value, [key]: e.target.value })}
                placeholder={config.placeholder}
                maxLength={config.max}
                disabled={disabled}
              />
            </label>
          ),
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
          <p className="field-hint">
            最多选择两项。没有合适的选项，也可以直接用文字补充。
          </p>
        </fieldset>
      )}
    </div>
  );
}

export function ContextTags({ context }: { context: Context }) {
  return (
    <div className="tags">
      {[
        context.topic,
        context.purpose && PURPOSES[context.purpose],
        context.scenario,
        ...context.priorities,
        context.constraints,
      ]
        .filter(Boolean)
        .map((label, index) => (
          <span key={`${label}-${index}`}>{label}</span>
        ))}
    </div>
  );
}
