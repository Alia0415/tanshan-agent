"use client";

import {
  ArrowUpRight,
  BookOpen,
  Check,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { useState } from "react";
import { filterZhihuPosts, previewExcerpt, sourceSignals } from "@/lib/domain/sources";
import type { Answer, ClarificationResponse, ClarificationRevision } from "@/lib/domain/types";
import { ContextTags } from "./context-fields";
import { ConditionEditor } from "./condition-editor";

function Citations({ ids, answer }: { ids: number[]; answer: Answer }) {
  return (
    <span className="citations">
      {ids
        .filter((id) => answer.sources.some((source) => source.id === id))
        .map((id) => (
          <a
            key={id}
            href={`#source-${answer.id}-${id}`}
            aria-label={`查看来源 ${id}`}
          >
            {id}
          </a>
        ))}
    </span>
  );
}

export function AnswerCard({
  answer,
  stale,
  onFeedback,
  onEditCondition,
  onLoadChoices,
  clarificationHistory = [],
  busy = false,
}: {
  answer: Answer;
  stale: boolean;
  onEditCondition?: (revision: ClarificationRevision) => void;
  clarificationHistory?: ClarificationResponse[];
  onLoadChoices?: (label: string, answerId: string) => Promise<{ history_index: number; card: import("@/lib/domain/types").ClarificationCard }>;
  busy?: boolean;
  onFeedback: (
    id: string,
    type: "helpful" | "irrelevant",
    reason?: string,
  ) => Promise<void>;
}) {
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const posts = filterZhihuPosts(answer.sources);
  const legacyOutsideSources = posts.length !== answer.sources.length;
  const [feedback, setFeedback] = useState<"helpful" | "irrelevant" | null>(
    null,
  );
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  async function send(type: "helpful" | "irrelevant") {
    setSending(true);
    setError("");
    try {
      await onFeedback(answer.id, type, reason);
      setFeedback(type);
      setReasonOpen(false);
    } catch {
      setError("反馈暂未提交，请再试一次。");
    } finally {
      setSending(false);
    }
  }
  return (
    <article className={`answer-card ${stale ? "old-answer" : ""}`}>
      <div className="answer-top">
        <span className="eyebrow">
          {stale ? "基于此前条件" : "本次回答依据的条件"}
        </span>
        <span className="answer-label">
          {answer.evidence === "demo"
            ? "演示回答"
            : answer.evidence === "insufficient"
              ? "资料不足"
              : answer.format === "zhida_text"
                ? "知乎直答 · 待核对"
                : answer.format === "source_excerpts"
                  ? "真实来源摘要"
                  : `${posts.length} 篇知乎帖子`}
        </span>
      </div>
      <ContextTags context={answer.context} labels={answer.condition_tags}
        disabled={busy}
        onSelect={!stale && onEditCondition ? (label) => {
          setEditingTag(label);
        } : undefined} />
      {!stale && editingTag !== null && onEditCondition && (
        <ConditionEditor key={editingTag} label={editingTag} answerId={answer.id} sources={answer.condition_sources} history={clarificationHistory}
          busy={busy} onLoadChoices={onLoadChoices} onSave={onEditCondition} onCancel={() => setEditingTag(null)} />
      )}
      <section className="sources post-results" aria-label="知乎帖子列表">
        <h2 className="posts-heading">
          为你找到的知乎帖子 <span>{posts.length}</span>
        </h2>
        <p className="posts-hint">
          {answer.search_info?.strategy === "fallback"
            ? "本次检索优化未全部完成，候选帖子是否适用还需核对。"
            : answer.search_info?.reviewed
              ? "已结合你的问题和补充筛选，相关性相近时参考互动量与更新时间排序。相关性由 AI 根据摘要判断，具体信息请核对原文。"
              : "点击帖子查看知乎原文；这里保留搜索返回的摘要。"}
        </p>
        {posts.length ? (
          posts.map((source) => (
            <a
              id={`source-${answer.id}-${source.id}`}
              className="source-card"
              key={source.id}
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="source-number">{source.id}</span>
              <div>
                <strong>{source.title}</strong>
                <p>
                  知乎 · {source.author || "作者未提供"} ·{" "}
                  {source.type.toLowerCase() === "answer"
                    ? "回答"
                    : source.type.toLowerCase() === "article"
                      ? "文章"
                      : "问题"}
                  {sourceSignals(source) && ` · ${sourceSignals(source)}`}
                </p>
                <small>
                  {previewExcerpt(source)}
                </small>
                {source.relevance && (
                  <p>筛选说明：{source.relevance.reason} {source.relevance.caveat}</p>
                )}
              </div>
              <span className="post-open">
                打开知乎原帖 <ArrowUpRight size={15} />
              </span>
            </a>
          ))
        ) : (
          <p className="empty-sources">
            {answer.evidence === "demo"
              ? "演示模式未检索真实帖子。"
              : "这次没有找到符合条件的知乎帖子，可以调整关键词再试。"}
          </p>
        )}
      </section>
      {legacyOutsideSources ? (
        <p className="posts-hint">
          这条历史回答包含此前的站外资料，已收起旧总结。新建提问将只检索知乎帖子。
        </p>
      ) : answer.format !== "source_excerpts" ? (
        <details className="ai-summary" open={answer.evidence === "demo"}>
          <summary>AI 辅助总结</summary>
          <p className="answer-summary">
            {answer.summary}
            <Citations ids={answer.summary_citations} answer={answer} />
          </p>
          <div className="answer-sections">
            {answer.sections.map((section, index) => (
              <section key={index}>
                <h3>
                  <span>0{index + 1}</span>
                  {section.title}
                </h3>
                <p>
                  {section.body}
                  <Citations ids={section.citations} answer={answer} />
                </p>
              </section>
            ))}
          </div>
          <aside className="limitations">
            <BookOpen size={18} />
            <div>
              <strong>还需要留意</strong>
              <ul>
                {answer.limitations.map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ul>
            </div>
          </aside>
        </details>
      ) : (
        <aside className="limitations">
          <BookOpen size={18} />
          <div>
            <strong>还需要留意</strong>
            <ul>
              {answer.limitations.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          </div>
        </aside>
      )}

      {!stale && (
        <div className="answer-actions">
          <div className="feedback-actions">
            {feedback ? (
              <span className="feedback-saved">
                <Check size={15} />
                感谢你的反馈
              </span>
            ) : (
              <>
                <button
                  type="button"
                  className="text-button"
                  disabled={sending}
                  onClick={() => void send("helpful")}
                >
                  <ThumbsUp size={15} />
                  有帮助
                </button>
                <button
                  type="button"
                  className="text-button"
                  disabled={sending}
                  onClick={() => setReasonOpen(!reasonOpen)}
                >
                  <ThumbsDown size={15} />
                  不太相关
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {reasonOpen && (
        <form
          className="feedback-form"
          onSubmit={(event) => {
            event.preventDefault();
            void send("irrelevant");
          }}
        >
          <label className="field-label">
            哪里不太相关？
            <textarea
              placeholder="可以告诉我们缺少了哪个角度（选填）"
              value={reason}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <button className="primary small" disabled={sending}>
            提交反馈
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
    </article>
  );
}
