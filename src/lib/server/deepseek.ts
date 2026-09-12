import { z } from "zod";
import { AppError } from "../domain/validation";

/** Shared server-only transport. Never log upstream bodies or retry paid requests. */
export async function deepseekJson(options: {
  feature: "CLARIFICATION" | "SEARCH" | "READING";
  instructions: string;
  input: unknown;
  maxTokens: number;
  timeoutMs?: number;
}): Promise<string> {
  const label = options.feature === "CLARIFICATION" ? "追问" : options.feature === "READING" ? "阅读整理" : "搜索优化";
  const fail = (suffix: string, message: string, status = 502) =>
    new AppError(`${options.feature}_${suffix}`, message, status);
  const key = process.env.DEEPSEEK_API_KEY?.trim();
  if (!key) throw fail("AUTH", "请在服务端配置 DeepSeek API Key 后重试。", 503);
  let result: unknown;
  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs || 30000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL?.trim() || "deepseek-flash",
        thinking: { type: "disabled" },
        stream: false,
        temperature: 0.3,
        max_tokens: options.maxTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: options.instructions },
          { role: "user", content: JSON.stringify(options.input) },
        ],
      }),
    });
    if ([401, 403].includes(response.status))
      throw fail("AUTH", "DeepSeek 密钥未通过验证，请检查服务端配置。", 503);
    if ([402, 429].includes(response.status))
      throw fail("LIMIT", "DeepSeek 余额或调用频率受限，请检查账户后重试。", 503);
    if (!response.ok) throw fail("UNAVAILABLE", `${label}服务暂不可用，请稍后重试。`);
    result = await response.json();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw fail("UNAVAILABLE", `${label}服务连接中断或超时，请稍后重试。`);
  }
  const completion = z.object({ choices: z.array(z.object({
    finish_reason: z.literal("stop"),
    message: z.object({ content: z.string().min(1).max(40000) }),
  })).min(1) }).safeParse(result);
  if (!completion.success) throw fail("INVALID", `${label}结果没有完整生成，请稍后重试。`);
  return completion.data.choices[0].message.content;
}
