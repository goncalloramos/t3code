import { assert, describe, it } from "@effect/vitest";
import { type VcsStatusResult, WS_METHODS } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import type { RpcHandlerObservers } from "./handlers.ts";
import { makeVcsStatusRpcHandlers, VCS_STATUS_RPC_METHODS } from "./vcs.ts";

const status = {} as VcsStatusResult;
const observeEffect: RpcHandlerObservers["observeEffect"] = (_method, effect) => effect;
const observeStream: RpcHandlerObservers["observeStream"] = (_method, stream) => stream;

describe("VCS status RPC handlers", () => {
  it("registers the existing status method identifiers without additions or omissions", () => {
    const handlers = makeVcsStatusRpcHandlers(
      {
        automaticGitFetchInterval: Effect.succeed(Duration.minutes(5)),
        vcsStatusBroadcaster: {
          streamStatus: () => Stream.empty,
          refreshStatus: () => Effect.succeed(status),
        },
      },
      { observeEffect, observeStream },
    );

    assert.deepStrictEqual(Object.keys(handlers), [...VCS_STATUS_RPC_METHODS]);
  });

  it("forwards the server-owned automatic refresh interval to status streams", () => {
    const automaticGitFetchInterval = Effect.succeed(Duration.minutes(5));
    let receivedInterval: unknown;
    const handlers = makeVcsStatusRpcHandlers(
      {
        automaticGitFetchInterval,
        vcsStatusBroadcaster: {
          streamStatus: (_input, options) => {
            receivedInterval = options?.automaticRemoteRefreshInterval;
            return Stream.empty;
          },
          refreshStatus: () => Effect.succeed(status),
        },
      },
      { observeEffect, observeStream },
    );

    const stream = handlers[WS_METHODS.subscribeVcsStatus]({ cwd: "/repo" });

    assert.strictEqual(receivedInterval, automaticGitFetchInterval);
    assert.notStrictEqual(stream, undefined);
  });
});
