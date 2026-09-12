import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError } from "../domain/validation";
import type { Source } from "../domain/types";
import {
  EXCHANGE_PAIR_PROMPT,
  GUEST_PROMPTS,
  ROSTER_PROMPT,
  STATEMENTS_PROMPT,
  SUMMARY_PROMPT,
  USER_REPLY_PROMPT,
} from "./prompts";

export type RoundPhase =
  | "opening"
  | "statement"
  | "exchange"
  | "summary"
  | "followup"
  | "user";
export interface RoundRole {
  id: string;
  name: string;
  description: string;
  kind: "host" | "viewpoint" | "guest";
  sourceIds: number[];
}
export interface RoundMessage {
  id: string;
  speaker: string;
  phase: RoundPhase;
  content: string;
  replyTo?: string;
  citations: number[];
  order: number;
}
export interface Roundtable {
  id: string;
  question: string;
  createdAt: string;
  expiresAt: string;
  provider: "live";
  model: string | null;
  // Sources are embedded so knowledge bases stay intact across restarts;
  // only their ids appear in citations.
  sources: Source[];
  roles: RoundRole[];
  messages: RoundMessage[];
  commonGround: string[];
  disagreements: string[];
  scheduler: { state: "running" | "complete"; turn: number };
}
export type ModelJson = (prompt: string, payload: unknown) => Promise<unknown>;

const EXCHANGES_PER_ROLE = 2;
const MAX_MESSAGES = 24;
export const GUESTS: RoundRole[] = [
  {
    id: "guest-counter",
    name: "反方追问者",
    description: "不持立场，只负责向刚发言的嘉宾提出最尖锐的追问。",
    kind: "guest",
    sourceIds: [],
  },
  {
    id: "guest-evidence",
    name: "证据核验员",
    description: "核对最近发言与真实来源，指出证据扎实与过度引申之处。",
    kind: "guest",
    sourceIds: [],
  },
  {
    id: "guest-context",
    name: "背景补充员",
    description: "从尚未被引用的来源中补充与当前争论相关的背景事实。",
    kind: "guest",
    sourceIds: [],
  },
];
const GUEST_IDS = GUESTS.map((guest) => guest.id);
const guestFor = (id: string) => GUESTS.find((guest) => guest.id === id);

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : undefined;
}
function citationsOf(
  value: unknown,
  allowed: number[],
  sources: Source[],
): number[] {
  if (!Array.isArray(value)) return [];
  const known = new Set(sources.map((source) => source.id));
  return [
    ...new Set(
      value
        .filter((id): id is number => typeof id === "number" && known.has(id)),
    ),
  ]
    .filter((id) => allowed.includes(id))
    .slice(0, 6);
}
// Never trust model-written evidence text: once the ID validates, the visible
// excerpt comes from the stored source, so only IDs are kept.
function validCitations(value: unknown, role: RoundRole, sources: Source[]) {
  const direct = citationsOf(value, role.sourceIds, sources);
  return direct.length ? direct : role.sourceIds.slice(0, 2);
}
function schedulerInput(question: string, sources: Source[], round: Roundtable, candidates: string[]) {
  return {
    question,
    sources: sources.map(({ id, title, excerpt, author, url }) => ({
      id,
      title,
      excerpt,
      author,
      url,
    })),
    candidates: round.roles
      .filter((role) => candidates.includes(role.id))
      .map((role) => ({
        id: role.id,
        name: role.name,
        description: role.description,
        knowledgeBase: sources.filter((source) =>
          role.sourceIds.includes(source.id),
        ),
      })),
    transcript: round.messages.map((message) => ({
      id: message.id,
      speaker: message.speaker,
      speakerName:
        round.roles.find((role) => role.id === message.speaker)?.name ??
        "现场访客",
      phase: message.phase,
      content: message.content,
    })),
  };
}
function pushMessage(
  round: Roundtable,
  message: Omit<RoundMessage, "order">,
): RoundMessage {
  const full = { ...message, order: round.messages.length };
  round.messages.push(full);
  round.scheduler = {
    state: round.scheduler?.state === "complete" ? "complete" : "running",
    turn: round.messages.length - 1,
  };
  return full;
}
// Validate and append one turn object from a batched model output. Invalid
// turns are dropped so a batch keeps its usable members.
function appendTurn(
  round: Roundtable,
  sources: Source[],
  value: unknown,
  phase: "statement" | "exchange",
  allowed: string[],
  firstTurnId?: string,
): RoundMessage | undefined {
  if (!value || typeof value !== "object") return;
  const turn = value as Record<string, unknown>;
  const speaker = text(turn.speakerRoleId, 40);
  if (!speaker || !allowed.includes(speaker)) return;
  const role = round.roles.find((item) => item.id === speaker);
  if (!role) return;
  if (
    phase === "statement" &&
    round.messages.some(
      (message) =>
        message.phase === "statement" && message.speaker === speaker,
    )
  )
    return;
  const content = text(turn.content, 2000);
  if (!content) return;
  let replyTo = text(turn.replyToMessageId, 80);
  if (firstTurnId && replyTo === "first-turn") replyTo = firstTurnId;
  if (phase === "statement") replyTo = undefined;
  else {
    const target = round.messages.find((message) => message.id === replyTo);
    if (!target || target.speaker === speaker) {
      const fallback = [...round.messages]
        .reverse()
        .find((message) => message.speaker !== speaker);
      if (!fallback) return;
      replyTo = fallback.id;
    }
  }
  return pushMessage(round, {
    id: `turn-${randomUUID()}`,
    speaker,
    phase,
    content,
    replyTo,
    citations: validCitations(turn.citations, role, sources),
  });
}

export async function createRoundtable(
  id: string,
  question: string,
  sources: Source[],
  model: ModelJson,
  model_name: string | null,
): Promise<Roundtable> {
  const rosterSchema = z.object({
    opening: z.object({ content: z.string().min(1).max(1200) }),
    roles: z
      .array(
        z.object({
          name: z.string().min(1).max(24),
          description: z.string().min(1).max(160),
          sourceIds: z.array(z.number().int().positive()).min(1).max(12),
        }),
      )
      .min(2)
      .max(3),
  });
  const parsed = rosterSchema.safeParse(
    await model(ROSTER_PROMPT, {
      question,
      sources: sources.map(({ id, title, excerpt, author, url }) => ({
        id,
        title,
        excerpt,
        author,
        url,
      })),
    }),
  );
  if (!parsed.success)
    throw new AppError(
      "INVALID_ROSTER",
      "圆桌角色未能生成，请稍后重试。",
      502,
    );
  const known = new Set(sources.map((source) => source.id));
  const roles: RoundRole[] = [];
  parsed.data.roles.forEach((role, index) => {
    const sourceIds = [
      ...new Set(role.sourceIds.filter((sid) => known.has(sid))),
    ];
    if (!sourceIds.length) return;
    roles.push({
      id: `role-${index + 1}`,
      name: role.name,
      description: role.description,
      kind: "viewpoint",
      sourceIds,
    });
  });
  if (roles.length < 2)
    throw new AppError(
      "INSUFFICIENT_VIEWS",
      "当前材料还不足以形成两种有依据的观点。",
      422,
    );
  const now = new Date();
  const round: Roundtable = {
    id,
    question,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
    provider: "live",
    model: model_name,
    sources,
    roles: [
      {
        id: "host",
        name: "主持人",
        description: "组织发言顺序，只在关键节点总结。",
        kind: "host",
        sourceIds: sources.map((source) => source.id),
      },
      ...roles,
      ...GUESTS.map((guest) => ({
        ...guest,
        sourceIds: sources.map((source) => source.id),
      })),
    ],
    messages: [],
    commonGround: [],
    disagreements: [],
    scheduler: { state: "running", turn: 0 },
  };
  pushMessage(round, {
    id: `opening-${randomUUID()}`,
    speaker: "host",
    phase: "opening",
    content: parsed.data.opening.content.trim(),
    citations: [],
  });
  return round;
}

export async function advanceRoundtable(
  round: Roundtable,
  sources: Source[],
  model: ModelJson,
): Promise<boolean> {
  if (round.scheduler.state === "complete") return false;
  const viewpoints = round.roles.filter((role) => role.kind === "viewpoint");
  const stated = new Set(
    round.messages
      .filter((message) => message.phase === "statement")
      .map((message) => message.speaker),
  );
  const missing = viewpoints.filter((role) => !stated.has(role.id));
  if (missing.length) {
    const candidates = missing.map((role) => role.id);
    const output = await model(
      STATEMENTS_PROMPT,
      schedulerInput(round.question, sources, round, candidates),
    );
    const turns = Array.isArray(
      (output as { turns?: unknown[] } | null)?.turns,
    )
      ? (output as { turns: unknown[] }).turns
      : [];
    const speakers: string[] = [];
    for (const turn of turns.slice(0, candidates.length)) {
      const message = appendTurn(
        round,
        sources,
        turn,
        "statement",
        candidates,
      );
      if (message) speakers.push(message.speaker);
    }
    if (!speakers.length)
      throw new AppError(
        "INVALID_TURNS",
        "本轮观点陈述未能生成，请重试。",
        502,
      );
    return true;
  }
  const viewpointExchanges = round.messages.filter(
    (message) =>
      message.phase === "exchange" && !GUEST_IDS.includes(message.speaker),
  );
  const summaryExchanges = Math.max(
    8,
    viewpoints.length * EXCHANGES_PER_ROLE,
  );
  if (
    viewpointExchanges.length >= summaryExchanges ||
    round.messages.length >= MAX_MESSAGES
  ) {
    const schema = z.object({
      content: z.string().min(1).max(2000),
      citations: z.array(z.number().int().positive()).min(1).max(8),
      commonGround: z.array(z.string().max(120)).max(4).catch([]),
      disagreements: z.array(z.string().max(120)).max(4).catch([]),
    });
    const parsed = schema.safeParse(
      await model(SUMMARY_PROMPT, {
        question: round.question,
        sources,
        transcript: round.messages,
      }),
    );
    const known = new Set(sources.map((source) => source.id));
    const citations = parsed.success
      ? parsed.data.citations.filter((id) => known.has(id))
      : [];
    if (!parsed.success || !citations.length)
      throw new AppError(
        "INVALID_SUMMARY",
        "主持人总结未能生成，请重试。",
        502,
      );
    pushMessage(round, {
      id: `summary-${randomUUID()}`,
      speaker: "host",
      phase: "summary",
      content: parsed.data.content.trim(),
      citations,
    });
    round.commonGround = parsed.data.commonGround;
    round.disagreements = parsed.data.disagreements;
    round.scheduler = {
      state: "complete",
      turn: round.messages.length - 1,
    };
    return true;
  }
  // After every two viewpoint exchanges the host invites one unused guest to
  // interject: challenge, fact-check or add unseen context.
  if (
    viewpointExchanges.length >= 2 &&
    viewpointExchanges.length % 2 === 0 &&
    viewpointExchanges.length < 10 &&
    !GUEST_IDS.includes(round.messages.at(-1)?.speaker || "")
  ) {
    const spoken = new Set(
      round.messages
        .map((message) => message.speaker)
        .filter((id) => GUEST_IDS.includes(id)),
    );
    const guest = GUESTS.find((entry) => !spoken.has(entry.id));
    if (guest) {
      try {
        const schema = z.object({
          content: z.string().min(1).max(1000),
          citations: z.array(z.number().int().positive()).max(6).catch([]),
        });
        const parsed = schema.safeParse(
          await model(
            GUEST_PROMPTS[guest.id],
            schedulerInput(round.question, sources, round, []),
          ),
        );
        if (!parsed.success) throw new Error("invalid guest output");
        const known = new Set(sources.map((source) => source.id));
        const cited = parsed.data.citations
          .filter((id) => known.has(id))
          .slice(0, 4);
        const target = [...round.messages]
          .reverse()
          .find(
            (message) =>
              !GUEST_IDS.includes(message.speaker) &&
              message.speaker !== "host" &&
              message.phase !== "summary",
          );
        pushMessage(round, {
          id: `${guest.id}-${randomUUID()}`,
          speaker: guest.id,
          phase: "exchange",
          content: parsed.data.content.trim(),
          replyTo: guest.id === "guest-counter" ? target?.id : undefined,
          citations:
            guest.id === "guest-counter"
              ? []
              : cited.length
                ? cited
                : sources.slice(0, 2).map((source) => source.id),
        });
        return true;
      } catch {
        // A guest failure must not stall the debate; fall through to a pair.
      }
    }
  }
  const previous = round.messages.at(-1)?.speaker;
  let candidates = viewpoints;
  // With only two viewpoints both must stay eligible, otherwise a reacting
  // pair cannot consist of two different speakers.
  if (candidates.length > 2)
    candidates = candidates.filter((role) => role.id !== previous);
  const candidateIds = candidates.map((role) => role.id);
  const output = await model(
    EXCHANGE_PAIR_PROMPT,
    schedulerInput(round.question, sources, round, candidateIds),
  );
  const turns = Array.isArray((output as { turns?: unknown[] } | null)?.turns)
    ? (output as { turns: unknown[] }).turns
    : [];
  const speakers: string[] = [];
  let firstId: string | undefined;
  for (const turn of turns.slice(0, 2)) {
    const message = appendTurn(
      round,
      sources,
      turn,
      "exchange",
      candidateIds,
      firstId,
    );
    if (message) {
      if (!firstId) firstId = message.id;
      speakers.push(message.speaker);
    }
  }
  if (!speakers.length)
    throw new AppError(
      "INVALID_TURNS",
      "本轮交锋未能生成，请重试。",
      502,
    );
  return true;
}

export async function joinUser(
  round: Roundtable,
  sources: Source[],
  model: ModelJson,
  content: string,
): Promise<void> {
  const userMessage = pushMessage(round, {
    id: `user-${randomUUID()}`,
    speaker: "user",
    phase: "user",
    content,
    citations: [],
  });
  const candidates = round.roles
    .filter((role) => role.kind === "viewpoint")
    .map((role) => role.id);
  const output = await model(
    USER_REPLY_PROMPT,
    {
      userMessageId: userMessage.id,
      ...schedulerInput(round.question, sources, round, candidates),
    },
  );
  const turns = Array.isArray((output as { turns?: unknown[] } | null)?.turns)
    ? (output as { turns: unknown[] }).turns
    : [];
  for (const turn of turns.slice(0, 1)) {
    appendTurn(round, sources, turn, "exchange", candidates, userMessage.id);
  }
}

export const guestName = (id: string) => guestFor(id)?.name ?? id;
