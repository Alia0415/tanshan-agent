import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mutateRoundtable } from "../src/lib/server/roundtable-mutation";

test("concurrent writes are rejected before paid work and other rooms remain available", async () => {
  const db = new DatabaseSync(":memory:");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const first = mutateRoundtable(db, "a", async (assertOwner) => {
    calls++;
    await gate;
    assertOwner();
    return "saved";
  });
  await assert.rejects(mutateRoundtable(db, "a", async () => { calls++; }), { code: "ROUNDTABLE_BUSY" });
  assert.equal(calls, 1);
  assert.equal(await mutateRoundtable(db, "b", async () => "other"), "other");
  release();
  assert.equal(await first, "saved");
  await mutateRoundtable(db, "a", async () => { calls++; });
  assert.equal(calls, 2);
  db.close();
});

test("failures release the lock and stale workers cannot save or release a successor", async () => {
  const db = new DatabaseSync(":memory:");
  await assert.rejects(mutateRoundtable(db, "a", async () => { throw new Error("model failed"); }));
  await assert.rejects(mutateRoundtable(db, "a", async (assertOwner) => {
    db.prepare("UPDATE roundtable_locks SET token = 'successor' WHERE id = 'a'").run();
    assertOwner();
  }), { code: "ROUNDTABLE_CONFLICT" });
  assert.equal((db.prepare("SELECT token FROM roundtable_locks WHERE id = 'a'").get() as { token: string }).token, "successor");
  db.prepare("UPDATE roundtable_locks SET expires = 0").run();
  await mutateRoundtable(db, "a", async (assertOwner) => { assertOwner(); });
  assert.equal(db.prepare("SELECT * FROM roundtable_locks").all().length, 0);
  db.close();
});
