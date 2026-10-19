import test from "node:test";
import assert from "node:assert/strict";
import type { Roundtable } from "../src/lib/roundtable/engine";
import { acceptsRoundtableUpdate, parseSavedRoundtable, roundtableUnavailable, savedRoundtable } from "../src/lib/roundtable/client-state";

const round = {
  id: "round-123e4567-e89b-42d3-a456-426614174000", question: "第一台相机如何选择？",
  provider: "demo", checkpoint: "signed-test-state", checkpointRevision: 2,
  createdAt: new Date(1000).toISOString(), expiresAt: new Date(10000).toISOString(),
  messages: [], scheduler: { state: "running", turn: 1 },
} as unknown as Roundtable;

test("only a bounded unexpired saved demo checkpoint becomes a recovery entry", () => {
  const saved = savedRoundtable(round)!;
  assert.deepEqual(parseSavedRoundtable(JSON.stringify(saved), 2000), saved);
  assert.equal(parseSavedRoundtable(JSON.stringify(saved), 10000), undefined);
  assert.equal(parseSavedRoundtable("{broken"), undefined);
  assert.equal(parseSavedRoundtable(JSON.stringify({ ...saved, checkpoint: "x".repeat(196609) }), 2000), undefined);
  assert.equal(parseSavedRoundtable(JSON.stringify({ ...saved, id: "untrusted/path" }), 2000), undefined);
  assert.equal(savedRoundtable({ ...round, checkpoint: undefined }), undefined);
  assert.equal(savedRoundtable({ ...round, provider: "live" }), undefined);
});

test("late summary or mutation responses cannot rewind or replace another room", () => {
  assert.equal(acceptsRoundtableUpdate(round, { ...round, checkpointRevision: 3 }), true);
  assert.equal(acceptsRoundtableUpdate(round, { ...round, checkpointRevision: 1 }), false);
  assert.equal(acceptsRoundtableUpdate(round, { ...round, id: "another-room", checkpointRevision: 3 }), false);
  const legacy = { ...round, checkpointRevision: undefined };
  assert.equal(acceptsRoundtableUpdate(legacy, { ...legacy, scheduler: { state: "running", turn: 0 } }), false);
  assert.equal(acceptsRoundtableUpdate(legacy, { ...legacy, scheduler: { state: "running", turn: 2 } }), true);
});

test("only terminal session failures disable discussion; transient limits remain retryable", () => {
  assert.equal(roundtableUnavailable({ code: "ROUNDTABLE_NOT_FOUND" }), true);
  assert.equal(roundtableUnavailable({ code: "SESSION_NOT_FOUND" }), true);
  assert.equal(roundtableUnavailable({ code: "ROUNDTABLE_BUSY" }), false);
  assert.equal(roundtableUnavailable({ code: "DEMO_AI_LIMIT" }), false);
  assert.equal(roundtableUnavailable(new Error("网络中断")), false);
});
