import { assert, describe, it } from "@effect/vitest";
import {
  type SourceControlCloneRepositoryResult,
  type SourceControlPublishRepositoryResult,
  type SourceControlRepositoryInfo,
  type VcsStatusResult,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";

import type { RpcHandlerObservers } from "./handlers.ts";
import { makeSourceControlRpcHandlers, SOURCE_CONTROL_RPC_METHODS } from "./sourceControl.ts";

const repository = {
  provider: "github",
  nameWithOwner: "t3tools/t3code",
  url: "https://github.com/t3tools/t3code.git",
  sshUrl: "git@github.com:t3tools/t3code.git",
} as const satisfies SourceControlRepositoryInfo;

const cloneResult = {
  cwd: "/repo/t3code",
  remoteUrl: repository.sshUrl,
  repository,
} satisfies SourceControlCloneRepositoryResult;

const publishResult = {
  repository,
  remoteName: "origin",
  remoteUrl: repository.sshUrl,
  branch: "main",
  upstreamBranch: "origin/main",
  status: "pushed",
} as const satisfies SourceControlPublishRepositoryResult;

const status = {} as VcsStatusResult;
const observeEffect: RpcHandlerObservers["observeEffect"] = (_method, effect) => effect;

function makeServices() {
  return {
    sourceControlRepositories: {
      lookupRepository: () => Effect.succeed(repository),
      cloneRepository: () => Effect.succeed(cloneResult),
      publishRepository: () => Effect.succeed(publishResult),
    },
    vcsStatusBroadcaster: { refreshStatus: () => Effect.succeed(status) },
  } satisfies Parameters<typeof makeSourceControlRpcHandlers>[0];
}

describe("source-control RPC handlers", () => {
  it("registers the existing repository methods without omissions", () => {
    const handlers = makeSourceControlRpcHandlers(makeServices(), { observeEffect });

    assert.deepStrictEqual(Object.keys(handlers), [...SOURCE_CONTROL_RPC_METHODS]);
  });

  it.effect("returns a publish result while scheduling a Git-status refresh", () =>
    Effect.gen(function* () {
      const refreshCalled = yield* Deferred.make<void>();
      const services = makeServices();
      const handlers = makeSourceControlRpcHandlers(
        {
          ...services,
          vcsStatusBroadcaster: {
            refreshStatus: () => Deferred.succeed(refreshCalled, undefined).pipe(Effect.as(status)),
          },
        },
        { observeEffect },
      );

      const result = yield* handlers[WS_METHODS.sourceControlPublishRepository]({
        cwd: "/repo",
        provider: "github",
        repository: "t3tools/t3code",
        visibility: "private",
      });
      yield* Deferred.await(refreshCalled);

      assert.deepStrictEqual(result, publishResult);
    }),
  );
});
