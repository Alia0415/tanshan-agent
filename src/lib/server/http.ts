import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { AppError } from "../domain/validation";

export async function identity(create = false) {
  const jar = await cookies();
  let token = jar.get("wenshan_browser")?.value;
  if (!token && create) {
    token = randomBytes(32).toString("hex");
  }
  if (!token || !/^[a-f0-9]{64}$/.test(token))
    throw new AppError(
      "SESSION_NOT_FOUND",
      "会话无法恢复，请开始新的提问。",
      404,
    );
  if (create)
    jar.set("wenshan_browser", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 86400,
      path: "/",
    });
  return token;
}

export async function body<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  const origin = request.headers.get("origin");
  // Next.js may reconstruct request.url with localhost even when the browser used 127.0.0.1.
  // Host is the public authority the browser actually addressed (also behind an HTTPS proxy).
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw new AppError(
        "ORIGIN_MISMATCH",
        "请求来源不匹配，请刷新后重试。",
        403,
      );
    }
    if (originHost !== request.headers.get("host"))
      throw new AppError(
        "ORIGIN_MISMATCH",
        "请求来源不匹配，请刷新后重试。",
        403,
      );
  }
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new AppError("INVALID_BODY", "请求内容需要使用 JSON 格式。", 415);
  if (Number(request.headers.get("content-length") || 0) > 16384)
    throw new AppError("BODY_TOO_LARGE", "输入内容太长。", 413);
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > 16384)
    throw new AppError("BODY_TOO_LARGE", "输入内容太长。", 413);
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new AppError("INVALID_BODY", "请求内容无法读取。");
  }
  const result = schema.safeParse(data);
  if (!result.success)
    throw new AppError(
      "VALIDATION_ERROR",
      result.error.issues[0]?.message || "请检查输入条件。",
    );
  return result.data;
}

export async function handle(action: () => Promise<unknown>, status = 200) {
  try {
    return NextResponse.json(await action(), {
      status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const e =
      error instanceof AppError
        ? error
        : new AppError(
            "INTERNAL_ERROR",
            "服务暂时无法完成请求，请稍后重试。",
            500,
          );
    // Do not log user text, credentials, raw upstream payloads, or arbitrary exception details.
    return NextResponse.json(
      { error: { code: e.code, message: e.message } },
      { status: e.status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
export type RouteContext = { params: Promise<{ id: string }> };
