import {
  type TerminalAttachStreamEvent,
  type TerminalError,
  type TerminalEvent,
  type TerminalMetadataStreamEvent,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import type * as TerminalManager from "../terminal/Manager.ts";
import type { RpcHandlerObservers } from "./handlers.ts";

export const TERMINAL_RPC_METHODS = [
  WS_METHODS.terminalOpen,
  WS_METHODS.terminalAttach,
  WS_METHODS.terminalWrite,
  WS_METHODS.terminalResize,
  WS_METHODS.terminalClear,
  WS_METHODS.terminalRestart,
  WS_METHODS.terminalClose,
  WS_METHODS.subscribeTerminalEvents,
  WS_METHODS.subscribeTerminalMetadata,
] as const;

export function makeTerminalRpcHandlers(
  terminalManager: TerminalManager.TerminalManager["Service"],
  { observeEffect, observeStream }: RpcHandlerObservers,
) {
  const traceAttributes = { "rpc.aggregate": "terminal" } as const;

  return {
    [WS_METHODS.terminalOpen]: (input: Parameters<typeof terminalManager.open>[0]) =>
      observeEffect(WS_METHODS.terminalOpen, terminalManager.open(input), traceAttributes),
    [WS_METHODS.terminalAttach]: (input: Parameters<typeof terminalManager.attachStream>[0]) =>
      observeStream(
        WS_METHODS.terminalAttach,
        Stream.callback<TerminalAttachStreamEvent, TerminalError>((queue) =>
          Effect.acquireRelease(
            terminalManager.attachStream(input, (event) => Queue.offer(queue, event)),
            (unsubscribe) => Effect.sync(unsubscribe),
          ),
        ),
        traceAttributes,
      ),
    [WS_METHODS.terminalWrite]: (input: Parameters<typeof terminalManager.write>[0]) =>
      observeEffect(WS_METHODS.terminalWrite, terminalManager.write(input), traceAttributes),
    [WS_METHODS.terminalResize]: (input: Parameters<typeof terminalManager.resize>[0]) =>
      observeEffect(WS_METHODS.terminalResize, terminalManager.resize(input), traceAttributes),
    [WS_METHODS.terminalClear]: (input: Parameters<typeof terminalManager.clear>[0]) =>
      observeEffect(WS_METHODS.terminalClear, terminalManager.clear(input), traceAttributes),
    [WS_METHODS.terminalRestart]: (input: Parameters<typeof terminalManager.restart>[0]) =>
      observeEffect(WS_METHODS.terminalRestart, terminalManager.restart(input), traceAttributes),
    [WS_METHODS.terminalClose]: (input: Parameters<typeof terminalManager.close>[0]) =>
      observeEffect(WS_METHODS.terminalClose, terminalManager.close(input), traceAttributes),
    [WS_METHODS.subscribeTerminalEvents]: (_input: {}) =>
      observeStream(
        WS_METHODS.subscribeTerminalEvents,
        Stream.callback<TerminalEvent>((queue) =>
          Effect.acquireRelease(
            terminalManager.subscribe((event) => Queue.offer(queue, event)),
            (unsubscribe) => Effect.sync(unsubscribe),
          ),
        ),
        traceAttributes,
      ),
    [WS_METHODS.subscribeTerminalMetadata]: (_input: {}) =>
      observeStream(
        WS_METHODS.subscribeTerminalMetadata,
        Stream.callback<TerminalMetadataStreamEvent>((queue) =>
          Effect.acquireRelease(
            terminalManager.subscribeMetadata((event) => Queue.offer(queue, event)),
            (unsubscribe) => Effect.sync(unsubscribe),
          ),
        ),
        traceAttributes,
      ),
  };
}
