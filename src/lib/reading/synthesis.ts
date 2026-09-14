import { z } from "zod";

export const synthesisSchema = z.object({
  summary: z.string().trim().min(1).max(1200),
  sections: z.array(z.object({
    key: z.enum(["facts", "logic", "impact", "disagreement"]),
    points: z.array(z.object({
      kind: z.enum(["材料陈述", "推断", "待核实"]),
      text: z.string().trim().min(1).max(1000),
      refs: z.array(z.string()).min(1).max(6),
    })).max(4),
  })).length(4),
});

const titles = { facts: "事实 · 发生了什么", logic: "逻辑 · 为什么发生", impact: "影响 · 会带来什么变化", disagreement: "分歧 · 哪些尚无定论" };
type Source = { ref: string; title: string; url: string };

export function resolveSynthesis(input: unknown, sources: Source[]) {
  const parsed = synthesisSchema.parse(input);
  if (new Set(parsed.sections.map(section => section.key)).size !== 4) throw new Error("AGENT_OUTPUT_INVALID");
  return {
    summary: parsed.summary,
    sections: (["facts", "logic", "impact", "disagreement"] as const).map(key => {
      const section = parsed.sections.find(section => section.key === key)!;
      return { key, title: titles[key], points: section.points.map(point => ({
        kind: point.kind, text: point.text,
        sources: [...new Set(point.refs)].map(ref => {
          const source = sources.find(source => source.ref === ref);
          if (!source) throw new Error("AGENT_OUTPUT_INVALID");
          return source;
        }),
      })) };
    }),
  };
}
export type Synthesis = ReturnType<typeof resolveSynthesis>;
