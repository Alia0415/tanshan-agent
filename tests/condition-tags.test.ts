import test from "node:test";
import assert from "node:assert/strict";
import { fallbackConditionTags } from "../src/lib/domain/condition-tags";

test("fallback tags retain answers and negation without presenting questions as facts", () => {
  assert.deepEqual(fallbackConditionTags({
    confirmed_context: { purpose: "solve", priorities: [] },
    free_text_context: ["关于「考虑尼康还是佳能？」：不考虑尼康", "关于「经验如何？」：新手", "关于「拍什么？」：风光", "关于「经验如何？」：新手", "直接回答"],
  }), ["不考虑尼康", "新手", "风光"]);
});

test("fallback uses supplied conditions and retains a purpose when no details exist", () => {
  assert.deepEqual(fallbackConditionTags({ confirmed_context: { purpose: "solve", priorities: [], constraints: "预算5000–8000元" }, free_text_context: [] }), ["预算5000–8000元"]);
  assert.deepEqual(fallbackConditionTags({ confirmed_context: { purpose: "solve", priorities: [] }, free_text_context: [] }), ["解决具体问题"]);
});
