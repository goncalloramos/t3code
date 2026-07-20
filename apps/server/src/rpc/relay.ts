import {
  RelayClientInstallFailedError,
  type RelayClientInstallProgressEvent,
  WS_METHODS,
} from "@t3tools/contracts";
import type * as RelayClient from "@t3tools/shared/relayClient";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import type { RpcHandlerObservers } from "./handlers.ts";

export const RELAY_RPC_METHODS = [
  WS_METHODS.cloudGetRelayClientStatus,
  WS_METHODS.cloudInstallRelayClient,
] as const;

export function makeRelayRpcHandlers(
  relayClient: RelayClient.RelayClientShape,
  { observeEffect, observeStream }: Pick<RpcHandlerObservers, "observeEffect" | "observeStream">,
) {
  return {
    [WS_METHODS.cloudGetRelayClientStatus]: (_input: {}) =>
      observeEffect(WS_METHODS.cloudGetRelayClientStatus, relayClient.resolve, {
        "rpc.aggregate": "cloud",
      }),
    [WS_METHODS.cloudInstallRelayClient]: (_input: {}) =>
      observeStream(
        WS_METHODS.cloudInstallRelayClient,
        Stream.callback<RelayClientInstallProgressEvent, RelayClientInstallFailedError>((queue) =>
          relayClient
            .installWithProgress((event) => Queue.offer(queue, event).pipe(Effect.asVoid))
            .pipe(
              Effect.flatMap((status) => Queue.offer(queue, { type: "complete", status })),
              Effect.catchTag("RelayClientInstallError", (error) =>
                Queue.fail(
                  queue,
                  new RelayClientInstallFailedError({
                    reason: error.reason,
                    message: error.message,
                  }),
                ),
              ),
              Effect.andThen(Queue.end(queue)),
              Effect.forkScoped,
            ),
        ),
        { "rpc.aggregate": "cloud" },
      ),
  };
}
