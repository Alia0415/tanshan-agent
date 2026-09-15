import assert from "node:assert/strict";
import test from "node:test";
import { readGenerationStream } from "../src/lib/reading/generation-stream";
function response(events: unknown[]) {
  const bytes = new TextEncoder().encode(events.map(event => JSON.stringify(event)).join("\n"));
  return new Response(new ReadableStream({start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); }}), { headers: {"Content-Type": "application/x-ndjson"} });
}
test("读取拆分中文数据和阶段进度，最终返回结果", async () => {
  const progress: number[] = [];
  const result = await readGenerationStream(response([{type:"progress",percent:15,label:"正在检索"},{type:"progress",percent:80,label:"正在综合"},{type:"progress",percent:100,label:"完成"},{type:"result",result:{summary:"结论"}}]), value => progress.push(value));
  assert.deepEqual(progress,[15,80,100]); assert.deepEqual(result,{summary:"结论"});
});
test("失败和提前断流不能视为成功", async () => {
  await assert.rejects(readGenerationStream(response([{type:"error",error:"筛选失败"}]),()=>{}),/筛选失败/);
  await assert.rejects(readGenerationStream(response([{type:"progress",percent:80,label:"综合"}]),()=>{}),/提前结束/);
});
