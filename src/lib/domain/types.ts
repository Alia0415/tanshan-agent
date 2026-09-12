export const PURPOSES = {
  undergraduate: "本科报考",
  postgraduate: "考研择校",
  campus: "校园生活",
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
  school?: string;
  purpose?: Purpose;
  major?: string;
  priorities: string[];
  province?: string;
  year?: string;
  campus?: string;
}
export interface ClarificationCard {
  kind: "purpose" | "details";
  title: string;
  description: string;
  fields: ("purpose" | "major" | "priorities")[];
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
}
export interface AnswerSection {
  title: string;
  body: string;
  citations: number[];
}
export interface Answer {
  id: string;
  context_version: number;
  context: Context;
  focused_question: string;
  summary: string;
  summary_citations: number[];
  sections: AnswerSection[];
  limitations: string[];
  sources: Source[];
  queries: string[];
  evidence: "demo" | "sources" | "insufficient";
  created_at: string;
}
export interface Session {
  session_id: string;
  original_question: string;
  stage: Stage;
  context_version: number;
  clarification_count: number;
  confirmed_context: Context;
  free_text_context: string[];
  focused_question: string;
  clarification?: ClarificationCard;
  answers: Answer[];
  provider: "demo" | "live";
  created_at: string;
  expires_at: string;
  error?: { code: string; message: string };
}
export interface ContextPatch {
  school?: string | null;
  purpose?: Purpose | null;
  major?: string | null;
  priorities?: string[];
  province?: string | null;
  year?: string | null;
  campus?: string | null;
}
