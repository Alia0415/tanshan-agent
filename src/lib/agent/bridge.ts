import { z } from "zod";
import { PURPOSES, type Session, type Purpose } from "../domain/types";
import { AppError } from "../domain/validation";
import { filterZhihuPosts, sourceSignals } from "../domain/sources";
import {
  createSession,
  clarify,
  updateContext,
  claimAnswer,
  runAnswer,
} from "../server/sessions";
import { getSession } from "../server/store";
import type { KnowledgeProvider } from "../server/providers";

// Internal application contract. A real Zhihu transport must authenticate and map its own fields.
export const agentMessageSchema = z
  .object({
    message: z.string().trim().min(1).max(2000),
    session_id: z.string().uuid().optional(),
    context_version: z.number().int().positive().optional(),
    request_id: z.string().uuid(),
  })
  .strict()
  .refine(
    (value) => Boolean(value.session_id) === Boolean(value.context_version),
    "继续会话时必须携带会话编号和版本",
  );
export type AgentMessage = z.infer<typeof agentMessageSchema>;

export function presentAgentReply(session: Session) {
  const answer = session.answers.find(
    (item) => item.context_version === session.context_version,
  );
  let text: string;
  if (session.clarification) {
    text =
      session.clarification.title + "\n" + session.clarification.description;
    if (session.clarification.kind === "purpose")
      text +=
        "\n" +
        Object.values(PURPOSES)
          .map((label, i) => `${i + 1}. ${label}`)
          .join("\n");
    if (session.clarification.kind === "contextual" && session.clarification.options?.length)
      text += "\n" + session.clarification.options.map((option, i) => `${i + 1}. ${option}`).join("\n");
    text += "\n你可以直接说，也可以回复“直接回答”。";
  } else if (answer) {
    const posts = filterZhihuPosts(answer.sources);
    const refs = (ids: number[]) =>
      ids.length ? ` ${ids.map((id) => `[${id}]`).join("")}` : "";
    text = [
      posts.length
        ? `为你找到 ${posts.length} 篇知乎帖子（以下为搜索摘要）：`
        : "本次没有检索到真实知乎帖子。",
      ...posts.map(
        (source) =>
          `[${source.id}] ${source.title} — ${source.author || "作者未提供"}（知乎）${sourceSignals(source) ? `\n${sourceSignals(source)}` : ""}\n${source.excerpt}${source.relevance ? `\nAI 筛选说明：${source.relevance.reason}${source.relevance.caveat ? ` ${source.relevance.caveat}` : ""}` : ""}\n${source.url}`,
      ),
      ...(posts.length !== answer.sources.length
        ? ["历史回答含有站外资料，旧总结已隐藏。新建提问将只检索知乎帖子。"]
        : [
            ...(answer.format === "source_excerpts"
              ? []
              : [
                  "AI 辅助总结",
                  answer.summary + refs(answer.summary_citations),
                  ...answer.sections.map(
                    (section) =>
                      `${section.title}\n${section.body}${refs(section.citations)}`,
                  ),
                ]),
            ...answer.limitations,
          ]),
    ].join("\n\n");
    if (answer.search_info?.strategy === "fallback")
      text = "本次检索优化未全部完成，候选资料是否适用仍需核对。\n\n" + text;
  } else if (session.error) text = session.error.message;
  else text = "正在结合你的条件检索和整理资料。";
  return {
    session_id: session.session_id,
    context_version: session.context_version,
    stage: session.stage,
    text,
    clarification: session.clarification,
    answer,
    provider: session.provider,
  };
}

/** ownerToken comes from a verified adapter, never from the user's submitted JSON. */
export async function receiveAgentMessage(
  raw: AgentMessage,
  ownerToken: string,
  provider?: KnowledgeProvider,
) {
  const input = agentMessageSchema.parse(raw);
  if (!ownerToken) throw new AppError("AUTH_REQUIRED", "缺少会话身份。", 401);
  let session: Session;
  if (!input.session_id)
    session = (await createSession(input.message, ownerToken)).session;
  else {
    session = getSession(input.session_id, ownerToken);
    if (session.context_version !== input.context_version)
      throw new AppError(
        "CONTEXT_CHANGED",
        "条件已更新，请读取当前会话后继续。",
        409,
      );
    if (["searching", "generating"].includes(session.stage))
      return presentAgentReply(session);
    if (session.stage === "clarifying") {
      const choice = Object.entries(PURPOSES).find(
        ([key, label], i) =>
          input.message === label ||
          input.message === key ||
          input.message === String(i + 1),
      )?.[0] as Purpose | undefined;
      const purposeChoice = session.clarification?.kind === "purpose" && choice;
      const options = session.clarification?.kind === "contextual" ? session.clarification.options || [] : [];
      const answer = options.find((option, i) => input.message === option || input.message === String(i + 1));
      session = (await clarify(session.session_id, ownerToken, {
        context_version: session.context_version,
        selections: purposeChoice ? { purpose: purposeChoice } : {},
        answer,
        free_text: purposeChoice || answer ? undefined : input.message,
        skip: /^(直接回答|跳过|不用追问|不要追问)[。！!]?$/u.test(
          input.message,
        ),
      })).session;
    } else if (!/^(直接回答|继续|重试)[。！!]?$/u.test(input.message)) {
      session = updateContext(session.session_id, ownerToken, {
        context_version: session.context_version,
        changes: {},
        free_text: input.message,
      }).session;
    }
  }
  if (["ready", "error"].includes(session.stage)) {
    const claimed = claimAnswer(
      session.session_id,
      ownerToken,
      session.context_version,
      input.request_id,
    );
    if (claimed.start)
      await runAnswer(
        session.session_id,
        session.context_version,
        input.request_id,
        provider,
      );
    session = getSession(session.session_id, ownerToken);
  }
  return presentAgentReply(session);
}
