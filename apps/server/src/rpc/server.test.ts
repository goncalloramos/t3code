import { assert, describe, it } from "@effect/vitest";
import { EnvironmentId, type ServerLifecycleStreamEvent, WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import type * as ServerConfig from "../config.ts";
import type { RpcHandlerObservers } from "./handlers.ts";
import { makeServerRpcHandlers, SERVER_RPC_METHODS } from "./server.ts";

const environment = {
  environmentId: EnvironmentId.make("environment-test"),
  label: "Test environment",
  platform: { os: "darwin" as const, arch: "arm64" as const },
  serverVersion: "0.0.0-test",
  capabilities: { repositoryIdentity: true, directAgentNotifications: false },
};

const welcome = {
  version: 1,
  sequence: 1,
  type: "welcome",
  payload: { environment, cwd: "/tmp/project", projectName: "project" },
} as const satisfies ServerLifecycleStreamEvent;

const ready = {
  version: 1,
  sequence: 2,
  type: "ready",
  payload: { at: "2026-01-01T00:00:00.000Z", environment },
} as const satisfies ServerLifecycleStreamEvent;

const nextReady = {
  ...ready,
  sequence: 3,
  payload: { ...ready.payload, at: "2026-01-01T00:00:01.000Z" },
} as const satisfies ServerLifecycleStreamEvent;

const observeEffect: RpcHandlerObservers["observeEffect"] = (_method, effect) => effect;
const observeStreamEffect: RpcHandlerObservers["observeStreamEffect"] = (_method, effect) =>
  Stream.unwrap(effect);

function makeServices() {
  return {
    config: {} as ServerConfig.ServerConfig["Service"],
    externalLauncher: { resolveAvailableEditors: () => Effect.never },
    keybindings: { loadConfigState: Effect.never, streamChanges: Stream.empty },
    lifecycleEvents: {
      snapshot: Effect.succeed({ sequence: 2, events: [ready, welcome] }),
      stream: Stream.fromIterable([ready, nextReady]),
    },
    processDiagnostics: { read: Effect.never, signal: () => Effect.never },
    processResourceMonitor: { readHistory: () => Effect.never },
    providerRegistry: {
      getProviders: Effect.never,
      refresh: () => Effect.never,
      streamChanges: Stream.empty,
    },
    serverAuth: { getDescriptor: () => Effect.never },
    serverEnvironment: { getDescriptor: Effect.never },
    serverSettings: { getSettings: Effect.never, streamChanges: Stream.empty },
    sourceControlDiscovery: { discover: Effect.never },
  } satisfies Parameters<typeof makeServerRpcHandlers>[0];
}

describe("server RPC handlers", () => {
  it("registers the existing server method identifiers without additions or omissions", () => {
    const handlers = makeServerRpcHandlers(makeServices(), {
      observeEffect,
      observeStreamEffect,
    });

    assert.deepStrictEqual(Object.keys(handlers), [...SERVER_RPC_METHODS]);
  });

  it.effect("sorts lifecycle snapshots and ignores already-snapshotted live events", () =>
    Effect.gen(function* () {
      const handlers = makeServerRpcHandlers(makeServices(), {
        observeEffect,
        observeStreamEffect,
      });
      const events = yield* handlers[WS_METHODS.subscribeServerLifecycle]({}).pipe(
        Stream.runCollect,
      );

      assert.deepStrictEqual(Array.from(events), [welcome, ready, nextReady]);
    }),
  );
});
