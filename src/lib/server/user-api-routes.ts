import { AppError } from "@/lib/domain/validation";
import { z } from "zod";
import { handle, identity } from "@/lib/server/http";
import { clearOAuthSession, fetchUserApi, requireOAuthSession } from "@/lib/server/oauth";

// 五个用户数据接口共用的代理工厂：登录校验 + 分页参数校验 + 不自动重试（真实上游调用）。

export const pageSchema = z
  .object({
    Offset: z.string().regex(/^\d+$/).refine((value) => /^\d+$/.test(value) && BigInt(value) <= 9223372036854775807n).optional(),
    Limit: z.coerce.number().int().min(1).max(50).optional(),
  })
  .strip();

export async function proxyUserApi(
  path: string,
  searchParams: URLSearchParams,
) {
  return handle(async () => {
    const visitor = await identity();
    const session = requireOAuthSession(visitor);
    const parsed = (path === "/api/v1/user/contents" ? contentQuerySchema : pageSchema).safeParse(Object.fromEntries(searchParams));
    if (!parsed.success) throw new AppError("INVALID_PAGINATION", "分页或内容类型参数无效。", 400);
    const query = parsed.data;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query))
      if (value !== undefined) params.set(key, String(value));
    const suffix = params.size ? "?" + params.toString() : "";
    try { return await fetchUserApi(path + suffix, session.accessToken); } catch (error) {
      if (error instanceof AppError && error.status === 401) clearOAuthSession(visitor);
      throw error;
    }
  });
}

export const favlistQuerySchema = z
  .object({
    FavlistUrlToken: z.coerce.number().int().min(1),
    Offset: z.string().regex(/^\d+$/).refine((value) => /^\d+$/.test(value) && BigInt(value) <= 9223372036854775807n).optional(),
    Limit: z.coerce.number().int().min(1).max(50).optional(),
  })
  .strip();

export const contentQuerySchema = pageSchema.extend({
  ContentType: z.enum(["all", "answer", "article", "zvideo", "pin", "question"]).default("all"),
  SortField: z.enum(["ts", "like_count"]).default("ts"),
  SortOrder: z.enum(["asc", "desc"]).default("desc"),
});
