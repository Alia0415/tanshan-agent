import test from "node:test";
import assert from "node:assert/strict";
import { conciseClaim, summarizeMessages } from "../src/lib/roundtable/brief";
import type { RoundMessage, Roundtable } from "../src/lib/roundtable/engine";

const message: RoundMessage = {
  id: "opening", speaker: "host", phase: "opening",
  content: "今天讨论我是否适合读博。第一，内在动机：是否愿意做研究；第二，现实门槛：心理承压、经济支持和沟通能力；第三，出口条件：职业去向与目标。",
  citations: [], order: 0,
};
const round = { question: "我是否适合读博？", messages: [message] } as Roundtable;
test("missing and overlong summaries never return the full content", () => {
  assert.equal(conciseClaim(message), undefined);
  assert.equal(conciseClaim({ ...message, summary: "长".repeat(41) }), undefined);
  assert.equal(conciseClaim({ ...message, summary: "动机：研究兴趣" }), "动机：研究兴趣");
});
test("historical messages are semantically summarized in one batch with full text preserved", async () => {
  let calls = 0;
  const claim = "动机：研究兴趣\n门槛：能力与支持\n出口：职业目标";
  const summaries = await summarizeMessages(round, ["opening"], async (_prompt, payload) => {
    calls++;
    assert.equal((payload as { messages: { content: string }[] }).messages[0].content, message.content);
    return { summaries: [{ id: "opening", claim }] };
  });
  assert.equal(calls, 1);
  assert.equal(summaries.opening, claim);
  assert.match(message.content, /今天讨论/);
});
test("saved short summaries avoid repeated model calls", async () => {
  const saved = { ...round, messages: [{ ...message, summary: "动机：研究兴趣" }] };
  assert.deepEqual(await summarizeMessages(saved, ["opening"], async () => {
    throw new Error("must not call");
  }), { opening: "动机：研究兴趣" });
});
test("invalid, missing, and oversized generated summaries are rejected", async () => {
  for (const summaries of [[], [{ id: "opening", claim: "" }], [{ id: "opening", claim: "字".repeat(41) }]]) {
    await assert.rejects(summarizeMessages(round, ["opening"], async () => ({ summaries })));
  }
});