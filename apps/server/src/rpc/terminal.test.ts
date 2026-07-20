import { assert, describe, it } from "@effect/vitest";
import { WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import type * as TerminalManager from "../terminal/Manager.ts";
import type { RpcHandlerObservers } from "./handlers.ts";
import { makeTerminalRpcHandlers, TERMINAL_RPC_METHODS } from "./terminal.ts";

const snapshot = {
  threadId: "thread-1",
  terminalId: "term-1",
  cwd: "/repo",
  worktreePath: null,
  status: "running",
  pid: 123,
  history: "",
  exitCode: null,
  exitSignal: null,
  label: "Shell",
  updatedAt: "2026-07-20T12:00:00.000Z",
  sequence: 1,
} as const;

function makeManager(
  overrides: Partial<TerminalManager.TerminalManager["Service"]> = {},
): TerminalManager.TerminalManager["Service"] {
  return {
    open: () => Effect.succeed(snapshot),
    attachStream: () => Effect.succeed(() => undefined),
    write: () => Effect.void,
    resize: () => Effect.void,
    clear: () => Effect.void,
    restart: () => Effect.succeed(snapshot),
    close: () => Effect.void,
    subscribe: () => Effect.succeed(() => undefined),
    subscribeMetadata: () => Effect.succeed(() => undefined),
    ...overrides,
  };
}

function makeObservers(
  calls: Array<{ method: string; aggregate: unknown }>,
): Pick<RpcHandlerObservers, "observeEffect" | "observeStream"> {
  return {
    observeEffect: (method, effect, attributes) => {
      calls.push({ method, aggregate: attributes?.["rpc.aggregate"] });
      return effect;
    },
    observeStream: (method, stream, attributes) => {
      calls.push({ method, aggregate: attributes?.["rpc.aggregate"] });
      return stream;
    },
  };
}

describe("terminal RPC handlers", () => {
  it("registers the existing terminal method identifiers without additions or omissions", () => {
    const handlers = makeTerminalRpcHandlers(makeManager(), makeObservers([]));

    assert.deepStrictEqual(Object.keys(handlers), [...TERMINAL_RPC_METHODS]);
  });

  it.effect("delegates unary calls through the central observer", () =>
    Effect.gen(function* () {
      const calls: Array<{ method: string; aggregate: unknown }> = [];
      const handlers = makeTerminalRpcHandlers(makeManager(), makeObservers(calls));

      const result = yield* handlers[WS_METHODS.terminalOpen]({
        threadId: "thread-1",
        terminalId: "term-1",
        cwd: "/repo",
      });

      assert.deepStrictEqual(result, snapshot);
      assert.deepStrictEqual(calls, [{ method: WS_METHODS.terminalOpen, aggregate: "terminal" }]);
    }),
  );

  it.effect("retains stream subscription cleanup", () =>
    Effect.gen(function* () {
      let unsubscribed = false;
      const manager = makeManager({
        attachStream: (_input, listener) =>
          listener({ type: "snapshot", snapshot }).pipe(
            Effect.as(() => {
              unsubscribed = true;
            }),
          ),
      });
      const handlers = makeTerminalRpcHandlers(manager, makeObservers([]));

      const event = yield* handlers[WS_METHODS.terminalAttach]({
        threadId: "thread-1",
        terminalId: "term-1",
      }).pipe(Stream.runHead);

      assert.strictEqual(Option.isSome(event), true);
      assert.deepStrictEqual(Option.getOrThrow(event), { type: "snapshot", snapshot });
      assert.strictEqual(unsubscribed, true);
    }),
  );
});
