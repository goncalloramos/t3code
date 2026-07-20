import {
  type SourceControlCloneRepositoryInput,
  type SourceControlPublishRepositoryInput,
  type SourceControlRepositoryLookupInput,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type * as SourceControlRepositoryService from "../sourceControl/SourceControlRepositoryService.ts";
import type * as VcsStatusBroadcaster from "../vcs/VcsStatusBroadcaster.ts";
import { refreshGitStatus } from "./git.ts";
import type { RpcHandlerObservers } from "./handlers.ts";

export const SOURCE_CONTROL_RPC_METHODS = [
  WS_METHODS.sourceControlLookupRepository,
  WS_METHODS.sourceControlCloneRepository,
  WS_METHODS.sourceControlPublishRepository,
] as const;

export function makeSourceControlRpcHandlers(
  services: {
    readonly sourceControlRepositories: Pick<
      SourceControlRepositoryService.SourceControlRepositoryService["Service"],
      "lookupRepository" | "cloneRepository" | "publishRepository"
    >;
    readonly vcsStatusBroadcaster: Pick<
      VcsStatusBroadcaster.VcsStatusBroadcaster["Service"],
      "refreshStatus"
    >;
  },
  { observeEffect }: Pick<RpcHandlerObservers, "observeEffect">,
) {
  const { sourceControlRepositories, vcsStatusBroadcaster } = services;

  return {
    [WS_METHODS.sourceControlLookupRepository]: (input: SourceControlRepositoryLookupInput) =>
      observeEffect(
        WS_METHODS.sourceControlLookupRepository,
        sourceControlRepositories.lookupRepository(input),
        { "rpc.aggregate": "source-control" },
      ),
    [WS_METHODS.sourceControlCloneRepository]: (input: SourceControlCloneRepositoryInput) =>
      observeEffect(
        WS_METHODS.sourceControlCloneRepository,
        sourceControlRepositories.cloneRepository(input),
        { "rpc.aggregate": "source-control" },
      ),
    [WS_METHODS.sourceControlPublishRepository]: (input: SourceControlPublishRepositoryInput) =>
      observeEffect(
        WS_METHODS.sourceControlPublishRepository,
        sourceControlRepositories
          .publishRepository(input)
          .pipe(Effect.tap(() => refreshGitStatus(vcsStatusBroadcaster, input.cwd))),
        { "rpc.aggregate": "source-control" },
      ),
  };
}
