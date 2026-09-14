import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  connectResonance,
  resonanceInputSchema,
  resonanceTopicKey,
  RESONANCE_TTL_MS,
  type ResonanceInput,
} from "../src/lib/server/resonance";

process.env.WENSHAN_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "tanshan-resonance-")),
  "resonance.sqlite",
);

const input: ResonanceInput = {
  question: "旅行时应该怎么选相机？",
  source_id: "zhihu:answer-456",
  source_title: "旅行相机选购经验",
  source_author: "测试作者",
  source_url: "https://www.zhihu.com/question/123/answer/456?utm_source=test",
};

test("resonance input only accepts complete Zhihu post data", () => {
  assert.equal(resonanceInputSchema.safeParse(input).success, true);
  assert.equal(
    resonanceInputSchema.safeParse({ ...input, source_url: "https://example.com/post" })
      .success,
    false,
  );
  assert.equal(
    resonanceInputSchema.safeParse({ ...input, unexpected: true }).success,
    false,
  );
  assert.equal(
    resonanceInputSchema.safeParse({ ...input, source_author: " " }).success,
    false,
  );
});

test("topic key groups answers by Zhihu question and otherwise uses source ID", () => {
  assert.equal(resonanceTopicKey(input), "question:123");
  assert.equal(
    resonanceTopicKey({
      source_id: "zhihu:article-789",
      source_url: "https://zhuanlan.zhihu.com/p/789",
    }),
    "source:zhihu:article-789",
  );
});

test("one anonymous owner counts once per topic without exposing identity", () => {
  const now = 2_000_000_000_000;
  const first = connectResonance(input, "owner-a", now);
  assert.deepEqual(first, { connected: true, count: 1, created: true });

  const duplicate = connectResonance(
    {
      ...input,
      source_id: "zhihu:another-answer",
      source_url: "https://www.zhihu.com/question/123/answer/999",
    },
    "owner-a",
    now + 1,
  );
  assert.deepEqual(duplicate, { connected: true, count: 1, created: false });
  assert.deepEqual(Object.keys(duplicate).sort(), ["connected", "count", "created"]);

  const secondOwner = connectResonance(input, "owner-b", now + 2);
  assert.deepEqual(secondOwner, { connected: true, count: 2, created: true });
});

test("expired resonance signals leave the count and may be created again", () => {
  const inputForExpiry = {
    ...input,
    source_id: "zhihu:expiry-answer",
    source_url: "https://www.zhihu.com/question/987/answer/654",
  };
  const now = 2_100_000_000_000;
  assert.deepEqual(connectResonance(inputForExpiry, "owner-expiry", now), {
    connected: true,
    count: 1,
    created: true,
  });
  assert.deepEqual(
    connectResonance(inputForExpiry, "owner-expiry", now + RESONANCE_TTL_MS + 1),
    { connected: true, count: 1, created: true },
  );
});
