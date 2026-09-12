import { z } from "zod";

const text = z.string().trim().max(100);
export const contextSchema = z
  .object({
    school: text.nullable().optional(),
    purpose: z
      .enum(["undergraduate", "postgraduate", "campus", "overview"])
      .nullable()
      .optional(),
    major: text.nullable().optional(),
    priorities: z
      .array(z.string().trim().min(1).max(40))
      .max(2)
      .refine((a) => new Set(a).size === a.length, "关注点不能重复")
      .optional(),
    province: text.nullable().optional(),
    year: z
      .string()
      .regex(/^20\d{2}$/)
      .nullable()
      .optional(),
    campus: text.nullable().optional(),
  })
  .strict();
const version = z.number().int().positive();
const freeText = z.string().trim().max(2000).optional();
export const createSchema = z
  .object({
    question: z
      .string()
      .trim()
      .min(1, "请先输入问题")
      .max(2000, "问题最多 2,000 字符"),
  })
  .strict();
export const clarifySchema = z
  .object({
    context_version: version,
    selections: contextSchema.default({}),
    free_text: freeText,
    skip: z.boolean().default(false),
  })
  .strict();
export const patchSchema = z
  .object({
    context_version: version,
    changes: contextSchema,
    free_text: freeText,
  })
  .strict();
export const answerSchema = z
  .object({ context_version: version, request_id: z.string().uuid() })
  .strict();
export const feedbackSchema = z
  .object({
    answer_id: z.string().uuid(),
    type: z.enum(["helpful", "irrelevant"]),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
