import { assert, describe, it } from "@effect/vitest";
import { FILL_PREVIEW_VIEWPORT, ThreadId, WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import type * as PreviewAutomationBroker from "../mcp/PreviewAutomationBroker.ts";
import type * as PreviewManager from "../preview/Manager.ts";
import type * as PortScanner from "../preview/PortScanner.ts";
import type { RpcHandlerObservers } from "./handlers.ts";
import { makePreviewRpcHandlers, PREVIEW_RPC_METHODS } from "./preview.ts";

const snapshot = {
  threadId: "thread-1",
  tabId: "tab-1",
  navStatus: { _tag: "Idle" },
  canGoBack: false,
  canGoForward: false,
  viewport: FILL_PREVIEW_VIEWPORT,
  updatedAt: "2026-07-20T12:00:00.000Z",
} as const;

function makeServices() {
  const previewManager = {
    open: () => Effect.succeed(snapshot),
    navigate: () => Effect.succeed(snapshot),
    reportStatus: () => Effect.void,
    resize: () => Effect.succeed(snapshot),
    refresh: () => Effect.void,
    close: () => Effect.void,
    list: () => Effect.succeed({ sessions: [snapshot] }),
    events: Stream.empty,
    subscribeEvents: Effect.never,
  } satisfies PreviewManager.PreviewManager["Service"];
  const previewAutomationBroker = {
    connect: () => Effect.succeed(Stream.empty),
    focusHost: () => Effect.void,
    respond: () => Effect.void,
    invoke: () => Effect.die("unused in RPC handler tests"),
  } satisfies PreviewAutomationBroker.PreviewAutomationBroker["Service"];
  const portDiscovery = {
    scan: () => Effect.succeed([]),
    subscribe: () => Effect.never,
    retain: Effect.void,
    registerTerminalProcesses: () => Effect.void,
    unregisterTerminal: () => Effect.void,
  } satisfies PortScanner.PortDiscovery["Service"];

  return { portDiscovery, previewAutomationBroker, previewManager };
}

function makeObservers(calls: Array<{ method: string; aggregate: unknown }>): RpcHandlerObservers {
  return {
    observeEffect: (method, effect, attributes) => {
      calls.push({ method, aggregate: attributes?.["rpc.aggregate"] });
      return effect;
    },
    observeStream: (method, stream, attributes) => {
      calls.push({ method, aggregate: attributes?.["rpc.aggregate"] });
      return stream;
    },
    observeStreamEffect: (method, effect, attributes) => {
      calls.push({ method, aggregate: attributes?.["rpc.aggregate"] });
      return Stream.unwrap(effect);
    },
  };
}

describe("preview RPC handlers", () => {
  it("registers the existing preview method identifiers without additions or omissions", () => {
    const handlers = makePreviewRpcHandlers(makeServices(), makeObservers([]));

    assert.deepStrictEqual(Object.keys(handlers), [...PREVIEW_RPC_METHODS]);
  });

  it.effect("keeps preview and automation tracing aggregates distinct", () =>
    Effect.gen(function* () {
      const calls: Array<{ method: string; aggregate: unknown }> = [];
      const handlers = makePreviewRpcHandlers(makeServices(), makeObservers(calls));

      const result = yield* handlers[WS_METHODS.previewOpen]({
        threadId: ThreadId.make("thread-1"),
      });
      yield* handlers[WS_METHODS.previewAutomationRespond]({
        clientId: "client-1",
        connectionId: "connection-1",
        requestId: "request-1",
        ok: true,
        result: { value: "ok" },
      });

      assert.deepStrictEqual(result, snapshot);
      assert.deepStrictEqual(calls, [
        { method: WS_METHODS.previewOpen, aggregate: "preview" },
        { method: WS_METHODS.previewAutomationRespond, aggregate: "preview-automation" },
      ]);
    }),
  );
});
