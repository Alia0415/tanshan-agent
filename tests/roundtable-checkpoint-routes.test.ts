import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { pathToFileURL } from "node:url";
import type { Roundtable } from "../src/lib/roundtable/engine";

test("roundtable HTTP handlers preserve demo checkpoints across lost SQLite rows", async t => {
  const saved = { ...process.env };
  const runtime = globalThis as unknown as {
    checkpointRouteCookie?: string;
    tanshanDb?: DatabaseSync;
    tanshanRounds?: boolean;
    tanshanCleanup?: NodeJS.Timeout;
  };
  const owner = "a".repeat(64);
  runtime.checkpointRouteCookie = owner;
  process.env.WENSHAN_PUBLIC_DEMO = "1";
  process.env.WENSHAN_DEMO_SESSION_SECRET = "test-only-checkpoint-route-secret-do-not-deploy";
  process.env.DEEPSEEK_API_KEY = "";
  process.env.ZHIHU_ACCESS_SECRET = "expired-secret-that-must-not-be-used";
  const directory = mkdtempSync(join(tmpdir(), "roundtable-routes-"));
  process.env.WENSHAN_DB_PATH = join(directory, "rounds.sqlite");

  // Keep the real body/schema/response code; only Next's request-bound cookie
  // access and its build-time marker need substitutes in this Node process.
  const cookiePath = join(directory, "next-headers.cjs");
  writeFileSync(cookiePath, `
    exports.cookies = async function cookies() {
      return { get(name) {
        return name === "wenshan_browser"
          ? { value: globalThis.checkpointRouteCookie } : undefined;
      } };
    };
  `);
  const cookieModule = pathToFileURL(cookiePath).href;
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") return { url: "node:util", shortCircuit: true };
      if (specifier === "next/headers") return { url: cookieModule, shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
  t.after(() => {
    hooks.deregister();
    if (runtime.tanshanCleanup) clearInterval(runtime.tanshanCleanup);
    runtime.tanshanDb?.close();
    delete runtime.tanshanDb;
    delete runtime.tanshanRounds;
    delete runtime.tanshanCleanup;
    delete runtime.checkpointRouteCookie;
    process.env = saved;
  });
  let networkCalls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    networkCalls += 1;
    throw new Error("Scripted route regression must not make external requests");
  });

  const [rooms, store, recover, advance, messages, guests, briefs] = await Promise.all([
    import("../src/lib/server/roundtables"),
    import("../src/lib/server/store"),
    import("../src/app/api/roundtables/[id]/route"),
    import("../src/app/api/roundtables/[id]/advance/route"),
    import("../src/app/api/roundtables/[id]/messages/route"),
    import("../src/app/api/roundtables/[id]/guests/route"),
    import("../src/app/api/roundtables/[id]/briefs/route"),
  ]);
  const context = (id: string) => ({ params: Promise.resolve({ id }) });
  const request = (id: string, suffix: string, input: unknown) => new Request(
    `http://localhost/api/roundtables/${id}${suffix}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Host: "localhost", Origin: "http://localhost" },
      body: JSON.stringify(input),
    },
  );
  const remove = (round: Roundtable) => {
    store.db().prepare("DELETE FROM roundtables WHERE id = ?").run(round.id);
  };
  const create = () => rooms.startRoundtable("第一台相机如何按拍摄场景选择？", owner);
  const verifyRevision = (before: Roundtable, after: Roundtable) => {
    assert.equal(after.id, before.id);
    assert.equal(after.checkpointRevision, before.checkpointRevision! + 1);
    assert.ok(after.checkpoint);
    assert.notEqual(after.checkpoint, before.checkpoint);
    assert.equal(rooms.readRoundtable(after.id, owner).checkpoint, after.checkpoint);
  };

  await t.test("POST recovery returns the full wrapper and preserves existing discussion", async () => {
    const round = await create();
    assert.ok(round.checkpoint);
    remove(round);
    const response = await recover.POST(request(round.id, "", { checkpoint: round.checkpoint }), context(round.id));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const payload = await response.json() as { roundtable: Roundtable };
    assert.deepEqual(Object.keys(payload), ["roundtable"]);
    assert.deepEqual(payload.roundtable.messages, JSON.parse(JSON.stringify(round.messages)));
    assert.equal(payload.roundtable.checkpoint, round.checkpoint);
    assert.equal(networkCalls, 0);
  });

  await t.test("advance, messages, guests and brief wrappers restore before mutating", async () => {
    let round = await create();
    const operations = [
      {
        handler: advance.POST, suffix: "/advance",
        input: (value: Roundtable) => ({ expectedTurn: value.scheduler.turn }),
        check: (value: Roundtable) => assert.ok(value.messages.some(message => message.phase === "statement")),
      },
      {
        handler: messages.POST, suffix: "/messages",
        input: () => ({ content: "我应该先试用什么？" }),
        check: (value: Roundtable) => assert.equal(value.messages.at(-2)?.speaker, "user"),
      },
      {
        handler: guests.POST, suffix: "/guests",
        input: () => ({ guestId: "guest-counter" }),
        check: (value: Roundtable) => assert.ok(value.joinedGuestIds?.includes("guest-counter")),
      },
    ];
    for (const operation of operations) {
      remove(round);
      const response = await operation.handler(request(round.id, operation.suffix, {
        ...operation.input(round), checkpoint: round.checkpoint,
      }), context(round.id));
      assert.equal(response.status, 200, operation.suffix);
      const next = await response.json() as Roundtable;
      verifyRevision(round, next);
      operation.check(next);
      round = next;
    }
    for (const kind of ["claim", "evidence"]) {
      remove(round);
      const id = round.messages.find(message => message.phase === "statement")!.id;
      const response = await briefs.POST(request(round.id, "/briefs", {
        ids: [id], kind, includeRound: true, checkpoint: round.checkpoint,
      }), context(round.id));
      assert.equal(response.status, 200);
      const payload = await response.json() as { summaries: Record<string, string | string[]>; roundtable: Roundtable };
      assert.deepEqual(Object.keys(payload).sort(), ["roundtable", "summaries"]);
      assert.ok(payload.summaries[id]);
      verifyRevision(round, payload.roundtable);
      round = payload.roundtable;
    }
    assert.equal(networkCalls, 0);
  });

  await t.test("brief requests without includeRound retain the legacy record response", async () => {
    const round = await create();
    const id = round.messages[0].id;
    remove(round);
    const response = await briefs.POST(request(round.id, "/briefs", {
      ids: [id], checkpoint: round.checkpoint,
    }), context(round.id));
    assert.equal(response.status, 200);
    const result = await response.json() as Record<string, string>;
    assert.deepEqual(Object.keys(result), [id]);
    assert.equal(typeof result[id], "string");
    assert.equal(networkCalls, 0);
  });

  await t.test("wrong owners, tampering and transport limits fail before restoration or generation", async () => {
    const round = await create();
    remove(round);
    runtime.checkpointRouteCookie = "b".repeat(64);
    const wrongOwner = await recover.POST(request(round.id, "", { checkpoint: round.checkpoint }), context(round.id));
    assert.equal(wrongOwner.status, 404);
    assert.equal((await wrongOwner.json()).error.code, "ROUNDTABLE_NOT_FOUND");
    runtime.checkpointRouteCookie = owner;
    const parts = round.checkpoint!.split(".");
    parts[2] = (parts[2][0] === "A" ? "B" : "A") + parts[2].slice(1);
    const tampered = await advance.POST(request(round.id, "/advance", {
      expectedTurn: round.scheduler.turn, checkpoint: parts.join("."),
    }), context(round.id));
    assert.equal(tampered.status, 404);
    const invalid = await recover.POST(request(round.id, "", {
      checkpoint: "x".repeat(196_609),
    }), context(round.id));
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error.code, "VALIDATION_ERROR");
    const tooLarge = await recover.POST(request(round.id, "", {
      checkpoint: round.checkpoint, padding: "x".repeat(262_145),
    }), context(round.id));
    assert.equal(tooLarge.status, 413);
    assert.equal((await tooLarge.json()).error.code, "BODY_TOO_LARGE");
    assert.equal(store.db().prepare("SELECT id FROM roundtables WHERE id = ?").get(round.id), undefined);
    assert.equal(networkCalls, 0);
  });
});
