import test from "node:test";
import assert from "node:assert/strict";
import { summarizeEvidence } from "../src/lib/roundtable/brief";
import type { Roundtable } from "../src/lib/roundtable/engine";

const round = { messages: [{ id: "a", speaker: "agent", content: "项目经历可补背景，但需要数学基础[3]。课程覆盖多类数据岗位[7]。", citations: [3, 7] }] } as Roundtable;

test("historical evidence is summarized into separate points without replacing original text", async () => {
  const points = ["门槛：项目经历可补背景，但需数学基础[3]", "出口：课程覆盖多类数据岗位[7]"];
  const result = await summarizeEvidence(round, ["a"], async (_prompt, input) => {
    assert.equal((input as { messages: { content: string }[] }).messages[0].content, round.messages[0].content);
    return { summaries: [{ id: "a", points }] };
  });
  assert.deepEqual(result, { a: points });
  assert.match(round.messages[0].content, /但需要数学基础/);
});

test("cached evidence avoids a model request", async () => {
  const saved = { ...round, messages: [{ ...round.messages[0], evidencePoints: ["条件：需要数学基础[3]"] }] };
  assert.deepEqual(await summarizeEvidence(saved, ["a"], async () => { throw new Error("must not call"); }), { a: ["条件：需要数学基础[3]"] });
});

test("missing, empty and overly long evidence summaries are rejected", async () => {
  for (const summaries of [[], [{ id: "a", points: [] }], [{ id: "a", points: ["字".repeat(61)] }]]) {
    await assert.rejects(summarizeEvidence(round, ["a"], async () => ({ summaries })));
  }
});
