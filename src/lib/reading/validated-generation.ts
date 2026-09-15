import { ZodError } from "zod";

export class ReadingFormatError extends Error {
  constructor(public stage: string) { super("AGENT_OUTPUT_INVALID"); }
}

export async function validatedGeneration<T>(stage: string, prompt: string, generate: (prompt: string) => Promise<unknown>, validate: (value: unknown) => T): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return validate(await generate(prompt + (attempt ? "\n上次输出未通过校验。请重新核对全部字段、数量、长度和引用，只返回符合上述结构的完整JSON。所有ref必须逐字复制自提供的材料，不得发明来源。" : "")));
    } catch (error) {
      const invalid = error instanceof SyntaxError || error instanceof ZodError || (error instanceof Error && error.message === "AGENT_OUTPUT_INVALID");
      if (!invalid) throw error;
      // Log only the stage and schema paths, never prompts, source text or secrets.
      console.warn("Reading format validation failed", { stage, attempt: attempt + 1,
        issues: error instanceof ZodError ? error.issues.map(issue => ({ path: issue.path, code: issue.code })) : error instanceof Error ? error.message : "invalid" });
      if (attempt === 1) throw new ReadingFormatError(stage);
    }
  }
  throw new ReadingFormatError(stage);
}
