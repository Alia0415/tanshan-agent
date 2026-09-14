import { test } from "node:test";
import assert from "node:assert/strict";
import { readStartStream } from "../src/lib/roundtable/start-stream";

test("delivers progress before completion across split UTF-8 bytes", async () => {
  const bytes = new TextEncoder().encode([
    JSON.stringify({ type: "progress", message: "正在整理观点", sources: [{ id: 1, title: "资料", url: "https://www.zhihu.com/question/1" }] }),
    JSON.stringify({ type: "complete", round: { id: "round-test" } }),
  ].join("\n"));
  const response = new Response(new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } }));
  const messages: string[] = [];
  const round = await readStartStream(response, (message, sources) => {
    messages.push(message);
    assert.equal(sources?.[0].title, "资料");
  });
  assert.equal(round.id, "round-test");
  assert.deepEqual(messages, ["正在整理观点"]);
});

test("surfaces upstream errors and incomplete streams", async () => {
  await assert.rejects(readStartStream(new Response('{"type":"error","message":"搜索超时"}\n'), () => {}), /搜索超时/);
  await assert.rejects(readStartStream(new Response('{"type":"progress","message":"检索中"}\n'), () => {}), /连接已中断/);
  await assert.rejects(readStartStream(new Response('{"error":{"message":"请求来源不匹配"}}', { status: 403 }), () => {}), /请求来源不匹配/);
});
