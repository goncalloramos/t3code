import { assert, describe, it } from "@effect/vitest";
import { type VcsStatusResult, WS_METHODS } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";

import type { RpcHandlerObservers } from "./handlers.ts";
import { GIT_RPC_METHODS, makeGitRpcHandlers } from "./git.ts";

const status = {} as VcsStatusResult;
const observeEffect: RpcHandlerObservers["observeEffect"] = (_method, effect) => effect;
const observeStream: RpcHandlerObservers["observeStream"] = (_method, stream) => stream;

function makeServices() {
  return {
    gitWorkflow: {
      pullCurrentBranch: () => Effect.never,
      runStackedAction: () => Effect.never,
      resolvePullRequest: () => Effect.never,
      preparePullRequestThread: () => Effect.never,
      listRefs: () => Effect.never,
      createWorktree: () => Effect.never,
      removeWorktree: () => Effect.never,
      createRef: () => Effect.never,
      switchRef: () => Effect.never,
    },
    review: { getDiffPreview: () => Effect.never },
    vcsProvisioning: { initRepository: () => Effect.never },
    vcsStatusBroadcaster: { refreshStatus: () => Effect.succeed(status) },
  } satisfies Parameters<typeof makeGitRpcHandlers>[0];
}

describe("Git RPC handlers", () => {
  it("registers the existing Git, worktree, and review methods without omissions", () => {
    const handlers = makeGitRpcHandlers(makeServices(), { observeEffect, observeStream });

    assert.deepStrictEqual(Object.keys(handlers), [...GIT_RPC_METHODS]);
  });

  it.effect("returns mutation results while scheduling the shared status refresh", () =>
    Effect.gen(function* () {
      const refreshCalled = yield* Deferred.make<void>();
      const services = makeServices();
      const handlers = makeGitRpcHandlers(
        {
          ...services,
          gitWorkflow: {
            ...services.gitWorkflow,
            createRef: (input) => Effect.succeed({ refName: input.refName }),
          },
          vcsStatusBroadcaster: {
            refreshStatus: () => Deferred.succeed(refreshCalled, undefined).pipe(Effect.as(status)),
          },
        },
        { observeEffect, observeStream },
      );

      const result = yield* handlers[WS_METHODS.vcsCreateRef]({
        cwd: "/repo",
        refName: "feature/rpc-registry",
      });
      yield* Deferred.await(refreshCalled);

      assert.deepStrictEqual(result, { refName: "feature/rpc-registry" });
    }),
  );
});
