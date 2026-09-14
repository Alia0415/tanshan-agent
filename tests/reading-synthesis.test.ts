import assert from "node:assert/strict";
import test from "node:test";
import { resolveSynthesis } from "../src/lib/reading/synthesis";
const source = { ref: "S1", title: "真实材料", url: "https://www.zhihu.com/question/1" };
const input = () => ({ summary: "总体判断", sections: ["impact", "facts", "logic", "disagreement"].map(key => ({ key, points: key === "impact" ? [{ kind: "推断", text: "条件成立时可能产生影响", refs: ["S1"] }] : [] })) });
test("综合解读按固定维度排序，保留空维度并解析真实来源", () => {
  const result = resolveSynthesis(input(), [source]);
  assert.deepEqual(result.sections.map(section => section.key), ["facts", "logic", "impact", "disagreement"]);
  assert.deepEqual(result.sections[2].points[0].sources, [source]);
  assert.equal(result.sections[0].points.length, 0);
});
test("拒绝不存在的来源和重复维度", () => {
  assert.throws(() => resolveSynthesis(input(), []));
  const duplicate = input();
  duplicate.sections[0].key = "facts";
  assert.throws(() => resolveSynthesis(duplicate, [source]));
});
test("拒绝没有引用的判断", () => {
  const missing = input();
  missing.sections[0].points[0].refs = [];
  assert.throws(() => resolveSynthesis(missing, [source]));
});
