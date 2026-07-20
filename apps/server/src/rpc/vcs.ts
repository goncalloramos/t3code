import { type VcsStatusInput, WS_METHODS } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

import type * as VcsStatusBroadcaster from "../vcs/VcsStatusBroadcaster.ts";
import type { RpcHandlerObservers } from "./handlers.ts";

export const VCS_STATUS_RPC_METHODS = [
  WS_METHODS.subscribeVcsStatus,
  WS_METHODS.vcsRefreshStatus,
] as const;

export function makeVcsStatusRpcHandlers(
  services: {
    readonly automaticGitFetchInterval: Effect.Effect<Duration.Duration>;
    readonly vcsStatusBroadcaster: Pick<
      VcsStatusBroadcaster.VcsStatusBroadcaster["Service"],
      "streamStatus" | "refreshStatus"
    >;
  },
  { observeEffect, observeStream }: Pick<RpcHandlerObservers, "observeEffect" | "observeStream">,
) {
  const traceAttributes = { "rpc.aggregate": "vcs" } as const;
  const { automaticGitFetchInterval, vcsStatusBroadcaster } = services;

  return {
    [WS_METHODS.subscribeVcsStatus]: (input: VcsStatusInput) =>
      observeStream(
        WS_METHODS.subscribeVcsStatus,
        vcsStatusBroadcaster.streamStatus(input, {
          automaticRemoteRefreshInterval: automaticGitFetchInterval,
        }),
        traceAttributes,
      ),
    [WS_METHODS.vcsRefreshStatus]: (input: VcsStatusInput) =>
      observeEffect(
        WS_METHODS.vcsRefreshStatus,
        vcsStatusBroadcaster.refreshStatus(input.cwd),
        traceAttributes,
      ),
  };
}
