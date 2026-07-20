import {
  type GitActionProgressEvent,
  type GitManagerServiceError,
  type GitPreparePullRequestThreadInput,
  type GitPullRequestRefInput,
  type GitRunStackedActionInput,
  type ReviewDiffPreviewInput,
  type VcsCreateRefInput,
  type VcsCreateWorktreeInput,
  type VcsInitInput,
  type VcsListRefsInput,
  type VcsPullInput,
  type VcsRemoveWorktreeInput,
  type VcsSwitchRefInput,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import type * as GitWorkflowService from "../git/GitWorkflowService.ts";
import type * as ReviewService from "../review/ReviewService.ts";
import type * as VcsProvisioningService from "../vcs/VcsProvisioningService.ts";
import type * as VcsStatusBroadcaster from "../vcs/VcsStatusBroadcaster.ts";
import type { RpcHandlerObservers } from "./handlers.ts";

export const GIT_RPC_METHODS = [
  WS_METHODS.vcsPull,
  WS_METHODS.gitRunStackedAction,
  WS_METHODS.gitResolvePullRequest,
  WS_METHODS.gitPreparePullRequestThread,
  WS_METHODS.vcsListRefs,
  WS_METHODS.vcsCreateWorktree,
  WS_METHODS.vcsRemoveWorktree,
  WS_METHODS.vcsCreateRef,
  WS_METHODS.vcsSwitchRef,
  WS_METHODS.vcsInit,
  WS_METHODS.reviewGetDiffPreview,
] as const;

export function refreshGitStatus(
  vcsStatusBroadcaster: Pick<VcsStatusBroadcaster.VcsStatusBroadcaster["Service"], "refreshStatus">,
  cwd: string,
) {
  return vcsStatusBroadcaster
    .refreshStatus(cwd)
    .pipe(Effect.ignoreCause({ log: true }), Effect.forkDetach, Effect.asVoid);
}

export function makeGitRpcHandlers(
  services: {
    readonly gitWorkflow: Pick<
      GitWorkflowService.GitWorkflowService["Service"],
      | "pullCurrentBranch"
      | "runStackedAction"
      | "resolvePullRequest"
      | "preparePullRequestThread"
      | "listRefs"
      | "createWorktree"
      | "removeWorktree"
      | "createRef"
      | "switchRef"
    >;
    readonly review: Pick<ReviewService.ReviewService["Service"], "getDiffPreview">;
    readonly vcsProvisioning: Pick<
      VcsProvisioningService.VcsProvisioningService["Service"],
      "initRepository"
    >;
    readonly vcsStatusBroadcaster: Pick<
      VcsStatusBroadcaster.VcsStatusBroadcaster["Service"],
      "refreshStatus"
    >;
  },
  { observeEffect, observeStream }: Pick<RpcHandlerObservers, "observeEffect" | "observeStream">,
) {
  const { gitWorkflow, review, vcsProvisioning, vcsStatusBroadcaster } = services;
  const refreshStatus = (cwd: string) => refreshGitStatus(vcsStatusBroadcaster, cwd);

  return {
    [WS_METHODS.vcsPull]: (input: VcsPullInput) =>
      observeEffect(
        WS_METHODS.vcsPull,
        gitWorkflow.pullCurrentBranch(input.cwd).pipe(
          Effect.matchCauseEffect({
            onFailure: (cause) => Effect.failCause(cause),
            onSuccess: (result) =>
              refreshStatus(input.cwd).pipe(Effect.ignore({ log: true }), Effect.as(result)),
          }),
        ),
        { "rpc.aggregate": "git" },
      ),
    [WS_METHODS.gitRunStackedAction]: (input: GitRunStackedActionInput) =>
      observeStream(
        WS_METHODS.gitRunStackedAction,
        Stream.callback<GitActionProgressEvent, GitManagerServiceError>((queue) =>
          gitWorkflow
            .runStackedAction(input, {
              actionId: input.actionId,
              progressReporter: {
                publish: (event) => Queue.offer(queue, event).pipe(Effect.asVoid),
              },
            })
            .pipe(
              Effect.matchCauseEffect({
                onFailure: (cause) => Queue.failCause(queue, cause),
                onSuccess: () =>
                  refreshStatus(input.cwd).pipe(
                    Effect.andThen(Queue.end(queue).pipe(Effect.asVoid)),
                  ),
              }),
            ),
        ),
        { "rpc.aggregate": "vcs" },
      ),
    [WS_METHODS.gitResolvePullRequest]: (input: GitPullRequestRefInput) =>
      observeEffect(WS_METHODS.gitResolvePullRequest, gitWorkflow.resolvePullRequest(input), {
        "rpc.aggregate": "git",
      }),
    [WS_METHODS.gitPreparePullRequestThread]: (input: GitPreparePullRequestThreadInput) =>
      observeEffect(
        WS_METHODS.gitPreparePullRequestThread,
        gitWorkflow
          .preparePullRequestThread(input)
          .pipe(Effect.tap(() => refreshStatus(input.cwd))),
        { "rpc.aggregate": "git" },
      ),
    [WS_METHODS.vcsListRefs]: (input: VcsListRefsInput) =>
      observeEffect(WS_METHODS.vcsListRefs, gitWorkflow.listRefs(input), {
        "rpc.aggregate": "vcs",
      }),
    [WS_METHODS.vcsCreateWorktree]: (input: VcsCreateWorktreeInput) =>
      observeEffect(
        WS_METHODS.vcsCreateWorktree,
        gitWorkflow.createWorktree(input).pipe(Effect.tap(() => refreshStatus(input.cwd))),
        { "rpc.aggregate": "vcs" },
      ),
    [WS_METHODS.vcsRemoveWorktree]: (input: VcsRemoveWorktreeInput) =>
      observeEffect(
        WS_METHODS.vcsRemoveWorktree,
        gitWorkflow.removeWorktree(input).pipe(Effect.tap(() => refreshStatus(input.cwd))),
        { "rpc.aggregate": "vcs" },
      ),
    [WS_METHODS.vcsCreateRef]: (input: VcsCreateRefInput) =>
      observeEffect(
        WS_METHODS.vcsCreateRef,
        gitWorkflow.createRef(input).pipe(Effect.tap(() => refreshStatus(input.cwd))),
        { "rpc.aggregate": "vcs" },
      ),
    [WS_METHODS.vcsSwitchRef]: (input: VcsSwitchRefInput) =>
      observeEffect(
        WS_METHODS.vcsSwitchRef,
        gitWorkflow.switchRef(input).pipe(Effect.tap(() => refreshStatus(input.cwd))),
        { "rpc.aggregate": "vcs" },
      ),
    [WS_METHODS.vcsInit]: (input: VcsInitInput) =>
      observeEffect(
        WS_METHODS.vcsInit,
        vcsProvisioning.initRepository(input).pipe(Effect.tap(() => refreshStatus(input.cwd))),
        { "rpc.aggregate": "vcs" },
      ),
    [WS_METHODS.reviewGetDiffPreview]: (input: ReviewDiffPreviewInput) =>
      observeEffect(WS_METHODS.reviewGetDiffPreview, review.getDiffPreview(input), {
        "rpc.aggregate": "review",
      }),
  };
}
