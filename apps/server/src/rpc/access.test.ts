import { assert, describe, it } from "@effect/vitest";
import { AuthSessionId, WS_METHODS } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import type { RpcHandlerObservers } from "./handlers.ts";
import { ACCESS_RPC_METHODS, makeAccessRpcHandlers } from "./access.ts";

const currentSessionId = AuthSessionId.make("current-session");
const otherSessionId = AuthSessionId.make("other-session");
const now = DateTime.makeUnsafe("2036-04-07T00:00:00.000Z");
const later = DateTime.makeUnsafe("2036-05-07T00:00:00.000Z");

const clientSession = {
  sessionId: currentSessionId,
  subject: "subject",
  scopes: ["orchestration:read"],
  method: "browser-session-cookie",
  client: { label: "This device", deviceType: "desktop" },
  issuedAt: now,
  expiresAt: later,
  lastConnectedAt: null,
  connected: true,
  current: false,
} as const;

const observeStreamEffect: RpcHandlerObservers["observeStreamEffect"] = (_method, effect) =>
  Stream.unwrap(effect);

function makeServices() {
  return {
    currentSessionId,
    serverAuth: {
      listPairingLinks: () => Effect.succeed([]),
      listClientSessions: (sessionId: AuthSessionId) => {
        assert.strictEqual(sessionId, currentSessionId);
        return Effect.succeed([clientSession]);
      },
    },
    bootstrapCredentials: {
      streamChanges: Stream.fromIterable([
        { type: "pairingLinkRemoved" as const, id: "pairing-link" },
      ]),
    },
    sessions: {
      streamChanges: Stream.fromIterable([
        { type: "clientUpserted" as const, clientSession },
        { type: "clientRemoved" as const, sessionId: otherSessionId },
      ]),
    },
  };
}

describe("access RPC handlers", () => {
  it("registers the existing access method identifiers without additions or omissions", () => {
    const handlers = makeAccessRpcHandlers(makeServices(), { observeStreamEffect });

    assert.deepStrictEqual(Object.keys(handlers), [...ACCESS_RPC_METHODS]);
  });

  it.effect("emits a reconnect snapshot followed by revisioned access changes", () =>
    Effect.gen(function* () {
      const handlers = makeAccessRpcHandlers(makeServices(), { observeStreamEffect });
      const events = yield* handlers[WS_METHODS.subscribeAuthAccess]({}).pipe(Stream.runCollect);
      const emitted = Array.from(events);

      assert.strictEqual(emitted[0]?.type, "snapshot");
      assert.deepStrictEqual(
        emitted.map((event) => event.revision),
        [1, 2, 3, 4],
      );
      const currentClientEvent = emitted.find((event) => event.type === "clientUpserted");
      assert.strictEqual(currentClientEvent?.payload.current, true);
      assert.deepStrictEqual(emitted.at(-1), {
        version: 1,
        revision: 4,
        type: "clientRemoved",
        payload: { sessionId: otherSessionId },
      });
    }),
  );
});
