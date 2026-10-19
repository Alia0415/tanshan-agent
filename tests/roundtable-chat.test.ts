import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Roundtable } from "../src/lib/roundtable/engine";

// CSS modules have no role in these server-rendered accessibility checks.
const require = createRequire(import.meta.url);
require.extensions[".css"] = (module) => { module.exports = {}; };
const { WeChatChat } = require("../src/components/roundtable/wechat-chat") as typeof import("../src/components/roundtable/wechat-chat");

const round: Roundtable = {
  id: "chat-test", question: "第一台相机如何选择？", provider: "demo", model: null,
  createdAt: "2026-10-19T00:00:00.000Z", expiresAt: "2026-10-20T00:00:00.000Z",
  roles: [{ id: "host", name: "主持人", kind: "host", description: "主持讨论", sourceIds: [] }],
  sources: [], messages: [{ id: "opening", speaker: "host", phase: "opening", content: "请围绕拍摄场景讨论。", citations: [], order: 0 }],
  commonGround: [], disagreements: [], scheduler: { state: "running", turn: 0 },
};
const props = { round, busy: "", error: "", playing: false, onSend: () => {}, onTogglePlaying: () => {} };
const render = (overrides: Partial<Parameters<typeof WeChatChat>[0]> = {}) => renderToStaticMarkup(createElement(WeChatChat, { ...props, ...overrides }));

test("a prepared round clearly points to the enabled automatic discussion control", () => {
  const html = render();
  assert.match(html, /开场已就绪/);
  assert.match(html, /让嘉宾依次发言/);
  assert.match(html, /aria-describedby="roundtable-play-guide"/);
  assert.match(html, /class="wechat-tool wechat-play ready" aria-pressed="false"/);
  assert.match(html, /等待开始/);
});

test("running, paused and completed rounds explain their actual discussion state", () => {
  const playing = render({ playing: true, busy: "主持人正在安排发言" });
  assert.match(playing, /暂停讨论/);
  assert.match(playing, /自动讨论中，可随时暂停/);
  assert.doesNotMatch(playing, /开场已就绪/);
  assert.match(playing, /class="wechat-tool wechat-play" aria-pressed="true"/);
  assert.match(playing, /placeholder="Agent 正在回应，可先输入…" aria-label="圆桌发言"/);
  assert.match(playing, /class="wechat-send" disabled="" aria-label="发送"/);
  const paused = render({ round: { ...round, scheduler: { state: "running", turn: 1 } } });
  assert.match(paused, /继续自动讨论/);
  assert.match(paused, /自动讨论已暂停/);
  assert.doesNotMatch(paused, /开场已就绪/);
  const complete = render({ round: { ...round, scheduler: { state: "complete", turn: 3 } } });
  assert.match(complete, /讨论已总结，你仍可在下方发言追问/);
  assert.match(complete, /讨论已结束/);
});

test("an unavailable round retains content, offers restart, and disables paid actions", () => {
  const claim = "试用：先按日常拍摄场景验证携带重量和操作习惯，再决定是否购买相机；样例中的经验仍需要结合自己的实际情况判断。";
  const html = render({
    unavailable: true, onRestart: () => {}, error: "这场圆桌不存在或已过期。",
    round: { ...round, messages: [...round.messages, {
      id: "statement", speaker: "host", phase: "statement", content: "完整发言仍可阅读。", citations: [], order: 1,
      brief: { claim, evidence: "试用样例。" },
    }] },
  });
  assert.ok(html.includes(claim));
  assert.match(html, /重新发起/);
  assert.match(html, /本场内容仍可阅读/);
  assert.match(html, /disabled="" aria-pressed="false"/);
  assert.match(html, /placeholder="请重新发起讨论" disabled=""/);
  assert.doesNotMatch(html, /重新生成观点/);
  assert.doesNotMatch(html, /开场已就绪/);
});
