import assert from "node:assert/strict";
import test from "node:test";
import { validatedGeneration, ReadingFormatError } from "../src/lib/reading/validated-generation";
import { z } from "zod";

test("格式失败只重试当前生成阶段，第二次通过后返回", async () => {
  let calls = 0;
  const result = await validatedGeneration("文章筛选", "task", async prompt => {
    calls++;
    if (calls === 2) assert.match(prompt, /上次输出未通过校验/);
    return calls;
  }, value => { if (value === 1) throw new Error("AGENT_OUTPUT_INVALID"); return value; });
  assert.equal(result, 2);
  assert.equal(calls, 2);
});
test("结构校验失败最多重试一次，并保留失败阶段", async () => {
  let calls = 0;
  await assert.rejects(validatedGeneration("综合解读", "task", async () => { calls++; return {}; }, value => z.object({ summary: z.string() }).parse(value)), error => error instanceof ReadingFormatError && error.stage === "综合解读");
  assert.equal(calls, 2);
});
test("网络错误不当作格式错误重复调用", async () => {
  let calls = 0;
  await assert.rejects(validatedGeneration("分类规划", "task", async () => { calls++; throw new Error("ZHIHU_HTTP_429"); }, value => value), /ZHIHU_HTTP_429/);
  assert.equal(calls, 1);
});
test("JSON解码错误可恢复", async () => {
  let calls = 0;
  assert.equal(await validatedGeneration("分类规划", "task", async () => JSON.parse(++calls === 1 ? "{" : "42"), value => value), 42);
});
