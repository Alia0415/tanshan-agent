export const MAX_CLARIFICATION_ROUNDS = 5;
export const PURPOSES = {
  understand: "了解与判断",
  decide: "比较与选择",
  solve: "解决具体问题",
  overview: "整体了解",
} as const;
export type Purpose = keyof typeof PURPOSES;
export type Stage =
  | "understanding"
  | "clarifying"
  | "ready"
  | "searching"
  | "generating"
  | "completed"
  | "error";
export interface Context {
  topic?: string;
  purpose?: Purpose;
  scenario?: string;
  priorities: string[];
  constraints?: string;
}
export interface ClarificationCard {
  kind: "purpose" | "details" | "contextual";
  title: string;
  description: string;
  fields: ("purpose" | "scenario" | "constraints" | "priorities")[];
  options?: string[];
  selection_mode?: "single" | "multiple";
  placeholder?: string;
}
export interface ClarificationResponse {
  question: string;
  answer: string;
  card?: ClarificationCard;
  selected?: string[];
  free_text?: string;
  supplement_index?: number;
}
export interface ClarificationRevision {
  history_index: number;
  selected: string[];
  free_text?: string;
}
export interface Source {
  id: number;
  content_id: string;
  title: string;
  author: string;
  type: string;
  excerpt: string;
  url: string;
  updated_at?: string;
  comment_count?: number;
  vote_up_count?: number;
  channel?: "zhihu" | "global";
  relevance?: { reason: string; evidence: string; caveat?: string; match_level?: "direct" | "background" };
}
export interface SearchInfo {
  strategy: "semantic" | "basic" | "fallback";
  candidate_count: number;
  selected_count: number;
  reviewed: boolean;
  expanded: boolean;
}
export interface AnswerSection {
  title: string;
  body: string;
  citations: number[];
}
export interface Answer {
  format?: "structured" | "zhida_text" | "source_excerpts";
  id: string;
  context_version: number;
  context: Context;
  focused_question: string;
  condition_tags?: string[];
  condition_sources?: { label: string; history_index: number }[];
  clarification_history?: ClarificationResponse[];
  summary: string;
  summary_citations: number[];
  sections: AnswerSection[];
  limitations: string[];
  sources: Source[];
  queries: string[];
  search_info?: SearchInfo;
  evidence: "demo" | "sources" | "insufficient" | "unverified";
  created_at: string;
}
export interface Session {
  schema_version: 2;
  session_id: string;
  original_question: string;
  stage: Stage;
  context_version: number;
  clarification_count: number;
  confirmed_context: Context;
  free_text_context: string[];
  focused_question: string;
  clarification?: ClarificationCard;
  clarification_history?: ClarificationResponse[];
  answers: Answer[];
  provider: "demo" | "live";
  created_at: string;
  expires_at: string;
  error?: { code: string; message: string };
}
export type SessionSummary = Pick<Session, "session_id" | "original_question" | "stage" | "created_at">;

export interface ContextPatch {
  topic?: string | null;
  purpose?: Purpose | null;
  scenario?: string | null;
  priorities?: string[];
  constraints?: string | null;
}
