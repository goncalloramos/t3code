import {
  CommandId,
  EventId,
  type OrchestrationCommand,
  OrchestrationDispatchCommandError,
  type OrchestrationEvent,
  OrchestrationGetFullThreadDiffError,
  OrchestrationGetSnapshotError,
  OrchestrationGetTurnDiffError,
  type OrchestrationShellStreamEvent,
  type OrchestrationShellStreamItem,
  type OrchestrationThreadStreamItem,
  ORCHESTRATION_WS_METHODS,
  OrchestrationReplayEventsError,
  ThreadId,
  WsOrchestrationDispatchCommandRpc,
  WsOrchestrationGetArchivedShellSnapshotRpc,
  WsOrchestrationGetFullThreadDiffRpc,
  WsOrchestrationGetTurnDiffRpc,
  WsOrchestrationReplayEventsRpc,
  WsOrchestrationSubscribeShellRpc,
  WsOrchestrationSubscribeThreadRpc,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import type * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { clamp } from "effect/Number";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import type * as CheckpointDiffQuery from "../checkpointing/CheckpointDiffQuery.ts";
import type * as GitWorkflowService from "../git/GitWorkflowService.ts";
import { normalizeDispatchCommand } from "../orchestration/Normalizer.ts";
import type * as OrchestrationEngine from "../orchestration/Services/OrchestrationEngine.ts";
import type * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import type * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";
import type * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import type * as ServerRuntimeStartup from "../serverRuntimeStartup.ts";
import type * as TerminalManager from "../terminal/Manager.ts";
import type * as VcsStatusBroadcaster from "../vcs/VcsStatusBroadcaster.ts";
import { refreshGitStatus } from "./git.ts";
import type { RpcHandlerObservers } from "./handlers.ts";

export const ORCHESTRATION_RPC_METHODS = [
  ORCHESTRATION_WS_METHODS.dispatchCommand,
  ORCHESTRATION_WS_METHODS.getTurnDiff,
  ORCHESTRATION_WS_METHODS.getFullThreadDiff,
  ORCHESTRATION_WS_METHODS.replayEvents,
  ORCHESTRATION_WS_METHODS.subscribeShell,
  ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot,
  ORCHESTRATION_WS_METHODS.subscribeThread,
] as const;

const OrchestrationRpcGroup = RpcGroup.make(
  WsOrchestrationDispatchCommandRpc,
  WsOrchestrationGetTurnDiffRpc,
  WsOrchestrationGetFullThreadDiffRpc,
  WsOrchestrationReplayEventsRpc,
  WsOrchestrationGetArchivedShellSnapshotRpc,
  WsOrchestrationSubscribeShellRpc,
  WsOrchestrationSubscribeThreadRpc,
);

const isOrchestrationDispatchCommandError = Schema.is(OrchestrationDispatchCommandError);
const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

function unexpectedCompatibilityError(error: never): never {
  throw new Error(`Unhandled compatibility error: ${String(error)}`);
}

/** Preserve the setup runner's broader pre-refactor message normalization. */
function legacySetupFailureDescription(cause: unknown): string {
  if (
    typeof cause === "object" &&
    cause !== null &&
    "message" in cause &&
    typeof cause.message === "string"
  ) {
    return cause.message;
  }
  return String(cause);
}

function projectSetupScriptCompatibilityDetail(
  error: ProjectSetupScriptRunner.ProjectSetupScriptRunnerError,
): string {
  switch (error._tag) {
    case "ProjectSetupScriptOperationError":
      return legacySetupFailureDescription(error.cause);
    case "ProjectSetupScriptProjectNotFoundError":
      return "Project was not found for setup script execution.";
    default:
      return unexpectedCompatibilityError(error);
  }
}

function isThreadDetailEvent(event: OrchestrationEvent): event is Extract<
  OrchestrationEvent,
  {
    type:
      | "thread.message-sent"
      | "thread.proposed-plan-upserted"
      | "thread.activity-appended"
      | "thread.turn-diff-completed"
      | "thread.reverted"
      | "thread.session-set";
  }
> {
  return (
    event.type === "thread.message-sent" ||
    event.type === "thread.proposed-plan-upserted" ||
    event.type === "thread.activity-appended" ||
    event.type === "thread.turn-diff-completed" ||
    event.type === "thread.reverted" ||
    event.type === "thread.session-set"
  );
}

export function makeOrchestrationRpcHandlers(
  services: {
    readonly crypto: Crypto.Crypto;
    readonly projectionSnapshotQuery: ProjectionSnapshotQuery.ProjectionSnapshotQuery["Service"];
    readonly orchestrationEngine: OrchestrationEngine.OrchestrationEngineService["Service"];
    readonly checkpointDiffQuery: CheckpointDiffQuery.CheckpointDiffQuery["Service"];
    readonly gitWorkflow: GitWorkflowService.GitWorkflowService["Service"];
    readonly vcsStatusBroadcaster: VcsStatusBroadcaster.VcsStatusBroadcaster["Service"];
    readonly terminalManager: TerminalManager.TerminalManager["Service"];
    readonly startup: ServerRuntimeStartup.ServerRuntimeStartup["Service"];
    readonly projectSetupScriptRunner: ProjectSetupScriptRunner.ProjectSetupScriptRunner["Service"];
    readonly repositoryIdentityResolver: RepositoryIdentityResolver.RepositoryIdentityResolver["Service"];
  },
  {
    observeEffect: observeRpcEffect,
    observeStreamEffect: observeRpcStreamEffect,
  }: Pick<RpcHandlerObservers, "observeEffect" | "observeStreamEffect">,
) {
  const {
    crypto,
    projectionSnapshotQuery,
    orchestrationEngine,
    checkpointDiffQuery,
    gitWorkflow,
    vcsStatusBroadcaster,
    terminalManager,
    startup,
    projectSetupScriptRunner,
    repositoryIdentityResolver,
  } = services;
  const toDispatchCommandError = (cause: unknown, fallbackMessage: string) =>
    isOrchestrationDispatchCommandError(cause)
      ? cause
      : new OrchestrationDispatchCommandError({
          message: cause instanceof Error ? cause.message : fallbackMessage,
          cause,
        });
  const randomUUID = crypto.randomUUIDv4.pipe(
    Effect.mapError((cause) =>
      toDispatchCommandError(cause, "Failed to generate orchestration command identifier."),
    ),
  );
  const serverEventId = randomUUID.pipe(Effect.map(EventId.make));
  const serverCommandId = (tag: string) =>
    randomUUID.pipe(Effect.map((uuid) => CommandId.make(`server:${tag}:${uuid}`)));

  const appendSetupScriptActivity = (input: {
    readonly threadId: ThreadId;
    readonly kind: "setup-script.requested" | "setup-script.started" | "setup-script.failed";
    readonly summary: string;
    readonly createdAt: string;
    readonly payload: Record<string, unknown>;
    readonly tone: "info" | "error";
  }) =>
    Effect.all({
      commandId: serverCommandId("setup-script-activity"),
      activityId: serverEventId,
    }).pipe(
      Effect.flatMap(({ commandId, activityId }) =>
        orchestrationEngine.dispatch({
          type: "thread.activity.append",
          commandId,
          threadId: input.threadId,
          activity: {
            id: activityId,
            tone: input.tone,
            kind: input.kind,
            summary: input.summary,
            payload: input.payload,
            turnId: null,
            createdAt: input.createdAt,
          },
          createdAt: input.createdAt,
        }),
      ),
    );

  const toBootstrapDispatchCommandCauseError = (cause: Cause.Cause<unknown>) => {
    const error = Cause.squash(cause);
    return isOrchestrationDispatchCommandError(error)
      ? error
      : new OrchestrationDispatchCommandError({
          message:
            error instanceof Error ? error.message : "Failed to bootstrap thread turn start.",
          cause,
        });
  };

  const enrichProjectEvent = (
    event: OrchestrationEvent,
  ): Effect.Effect<OrchestrationEvent, never, never> => {
    switch (event.type) {
      case "project.created":
        return repositoryIdentityResolver.resolve(event.payload.workspaceRoot).pipe(
          Effect.map((repositoryIdentity) => ({
            ...event,
            payload: {
              ...event.payload,
              repositoryIdentity,
            },
          })),
        );
      case "project.meta-updated":
        return Effect.gen(function* () {
          const workspaceRoot =
            event.payload.workspaceRoot ??
            Option.match(
              yield* projectionSnapshotQuery.getProjectShellById(event.payload.projectId),
              {
                onNone: () => null,
                onSome: (project) => project.workspaceRoot,
              },
            ) ??
            null;
          if (workspaceRoot === null) {
            return event;
          }

          const repositoryIdentity = yield* repositoryIdentityResolver.resolve(workspaceRoot);
          return {
            ...event,
            payload: {
              ...event.payload,
              repositoryIdentity,
            },
          } satisfies OrchestrationEvent;
        }).pipe(Effect.orElseSucceed(() => event));
      default:
        return Effect.succeed(event);
    }
  };

  const enrichOrchestrationEvents = (events: ReadonlyArray<OrchestrationEvent>) =>
    Effect.forEach(events, enrichProjectEvent, { concurrency: 4 });

  const toShellStreamEvent = (
    event: OrchestrationEvent,
  ): Effect.Effect<Option.Option<OrchestrationShellStreamEvent>, never, never> => {
    switch (event.type) {
      case "project.created":
      case "project.meta-updated":
        return projectionSnapshotQuery.getProjectShellById(event.payload.projectId).pipe(
          Effect.map((project) =>
            Option.map(project, (nextProject) => ({
              kind: "project-upserted" as const,
              sequence: event.sequence,
              project: nextProject,
            })),
          ),
          Effect.orElseSucceed(() => Option.none()),
        );
      case "project.deleted":
        return Effect.succeed(
          Option.some({
            kind: "project-removed" as const,
            sequence: event.sequence,
            projectId: event.payload.projectId,
          }),
        );
      case "thread.deleted":
      case "thread.archived":
        return Effect.succeed(
          Option.some({
            kind: "thread-removed" as const,
            sequence: event.sequence,
            threadId: event.payload.threadId,
          }),
        );
      case "thread.unarchived":
        return projectionSnapshotQuery.getThreadShellById(event.payload.threadId).pipe(
          Effect.map((thread) =>
            Option.map(thread, (nextThread) => ({
              kind: "thread-upserted" as const,
              sequence: event.sequence,
              thread: nextThread,
            })),
          ),
          Effect.orElseSucceed(() => Option.none()),
        );
      default:
        if (event.aggregateKind !== "thread") {
          return Effect.succeed(Option.none());
        }
        return projectionSnapshotQuery.getThreadShellById(ThreadId.make(event.aggregateId)).pipe(
          Effect.map((thread) =>
            Option.map(thread, (nextThread) => ({
              kind: "thread-upserted" as const,
              sequence: event.sequence,
              thread: nextThread,
            })),
          ),
          Effect.orElseSucceed(() => Option.none()),
        );
    }
  };

  const dispatchBootstrapTurnStart = (
    command: Extract<OrchestrationCommand, { type: "thread.turn.start" }>,
  ): Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError> =>
    Effect.gen(function* () {
      const bootstrap = command.bootstrap;
      const { bootstrap: _bootstrap, ...finalTurnStartCommand } = command;
      let createdThread = false;
      let targetProjectId = bootstrap?.createThread?.projectId;
      let targetProjectCwd = bootstrap?.prepareWorktree?.projectCwd;
      let targetWorktreePath = bootstrap?.createThread?.worktreePath ?? null;

      const cleanupCreatedThread = () =>
        createdThread
          ? serverCommandId("bootstrap-thread-delete").pipe(
              Effect.flatMap((commandId) =>
                orchestrationEngine.dispatch({
                  type: "thread.delete",
                  commandId,
                  threadId: command.threadId,
                }),
              ),
              Effect.ignoreCause({ log: true }),
            )
          : Effect.void;

      const recordSetupScriptLaunchFailure = (input: {
        readonly error: ProjectSetupScriptRunner.ProjectSetupScriptRunnerError;
        readonly requestedAt: string;
        readonly worktreePath: string;
      }) => {
        const detail = projectSetupScriptCompatibilityDetail(input.error);
        return appendSetupScriptActivity({
          threadId: command.threadId,
          kind: "setup-script.failed",
          summary: "Setup script failed to start",
          createdAt: input.requestedAt,
          payload: {
            detail,
            worktreePath: input.worktreePath,
          },
          tone: "error",
        }).pipe(
          Effect.ignoreCause({ log: false }),
          Effect.flatMap(() =>
            Effect.logWarning("bootstrap turn start failed to launch setup script", {
              threadId: command.threadId,
              worktreePath: input.worktreePath,
              detail,
            }),
          ),
        );
      };

      const recordSetupScriptStarted = (input: {
        readonly requestedAt: string;
        readonly worktreePath: string;
        readonly scriptId: string;
        readonly scriptName: string;
        readonly terminalId: string;
      }) =>
        Effect.gen(function* () {
          const startedAt = yield* nowIso;
          const payload = {
            scriptId: input.scriptId,
            scriptName: input.scriptName,
            terminalId: input.terminalId,
            worktreePath: input.worktreePath,
          };
          yield* Effect.all([
            appendSetupScriptActivity({
              threadId: command.threadId,
              kind: "setup-script.requested",
              summary: "Starting setup script",
              createdAt: input.requestedAt,
              payload,
              tone: "info",
            }),
            appendSetupScriptActivity({
              threadId: command.threadId,
              kind: "setup-script.started",
              summary: "Setup script started",
              createdAt: startedAt,
              payload,
              tone: "info",
            }),
          ]).pipe(
            Effect.asVoid,
            Effect.catch((error) =>
              Effect.logWarning(
                "bootstrap turn start launched setup script but failed to record setup activity",
                {
                  threadId: command.threadId,
                  worktreePath: input.worktreePath,
                  scriptId: input.scriptId,
                  terminalId: input.terminalId,
                  detail: error.message,
                },
              ),
            ),
          );
        });

      const runSetupProgram = () =>
        Effect.gen(function* () {
          if (!bootstrap?.runSetupScript || !targetWorktreePath) {
            return;
          }
          const worktreePath = targetWorktreePath;
          const requestedAt = yield* nowIso;
          yield* projectSetupScriptRunner
            .runForThread({
              threadId: command.threadId,
              ...(targetProjectId ? { projectId: targetProjectId } : {}),
              ...(targetProjectCwd ? { projectCwd: targetProjectCwd } : {}),
              worktreePath,
            })
            .pipe(
              Effect.matchEffect({
                onFailure: (error) =>
                  recordSetupScriptLaunchFailure({
                    error,
                    requestedAt,
                    worktreePath,
                  }),
                onSuccess: (setupResult) => {
                  if (setupResult.status !== "started") {
                    return Effect.void;
                  }
                  return recordSetupScriptStarted({
                    requestedAt,
                    worktreePath,
                    scriptId: setupResult.scriptId,
                    scriptName: setupResult.scriptName,
                    terminalId: setupResult.terminalId,
                  });
                },
              }),
            );
        });

      const bootstrapProgram = Effect.gen(function* () {
        if (bootstrap?.createThread) {
          yield* orchestrationEngine.dispatch({
            type: "thread.create",
            commandId: yield* serverCommandId("bootstrap-thread-create"),
            threadId: command.threadId,
            projectId: bootstrap.createThread.projectId,
            title: bootstrap.createThread.title,
            modelSelection: bootstrap.createThread.modelSelection,
            runtimeMode: bootstrap.createThread.runtimeMode,
            interactionMode: bootstrap.createThread.interactionMode,
            branch: bootstrap.createThread.branch,
            worktreePath: bootstrap.createThread.worktreePath,
            createdAt: bootstrap.createThread.createdAt,
          });
          createdThread = true;
        }

        if (bootstrap?.prepareWorktree) {
          let worktreeBaseRef = bootstrap.prepareWorktree.baseBranch;
          if (bootstrap.prepareWorktree.startFromOrigin) {
            yield* gitWorkflow.fetchRemote({
              cwd: bootstrap.prepareWorktree.projectCwd,
              remoteName: "origin",
            });
            const resolvedRemoteBase = yield* gitWorkflow.resolveRemoteTrackingCommit({
              cwd: bootstrap.prepareWorktree.projectCwd,
              refName: bootstrap.prepareWorktree.baseBranch,
              fallbackRemoteName: "origin",
            });
            worktreeBaseRef = resolvedRemoteBase.commitSha;
          }
          const worktree = yield* gitWorkflow.createWorktree({
            cwd: bootstrap.prepareWorktree.projectCwd,
            refName: worktreeBaseRef,
            newRefName: bootstrap.prepareWorktree.branch,
            baseRefName: bootstrap.prepareWorktree.baseBranch,
            path: null,
          });
          targetWorktreePath = worktree.worktree.path;
          yield* orchestrationEngine.dispatch({
            type: "thread.meta.update",
            commandId: yield* serverCommandId("bootstrap-thread-meta-update"),
            threadId: command.threadId,
            branch: worktree.worktree.refName,
            worktreePath: targetWorktreePath,
          });
          yield* refreshGitStatus(vcsStatusBroadcaster, targetWorktreePath);
        }

        yield* runSetupProgram();

        return yield* orchestrationEngine.dispatch(finalTurnStartCommand);
      });

      return yield* bootstrapProgram.pipe(
        Effect.catchCause((cause) => {
          const dispatchError = toBootstrapDispatchCommandCauseError(cause);
          if (Cause.hasInterruptsOnly(cause)) {
            return Effect.fail(dispatchError);
          }
          return cleanupCreatedThread().pipe(Effect.flatMap(() => Effect.fail(dispatchError)));
        }),
      );
    });

  const dispatchNormalizedCommand = (
    normalizedCommand: OrchestrationCommand,
  ): Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError> => {
    const dispatchEffect =
      normalizedCommand.type === "thread.turn.start" && normalizedCommand.bootstrap
        ? dispatchBootstrapTurnStart(normalizedCommand)
        : orchestrationEngine
            .dispatch(normalizedCommand)
            .pipe(
              Effect.mapError((cause) =>
                toDispatchCommandError(cause, "Failed to dispatch orchestration command"),
              ),
            );

    return startup
      .enqueueCommand(dispatchEffect)
      .pipe(
        Effect.mapError((cause) =>
          toDispatchCommandError(cause, "Failed to dispatch orchestration command"),
        ),
      );
  };

  return OrchestrationRpcGroup.of({
    [ORCHESTRATION_WS_METHODS.dispatchCommand]: (command) =>
      observeRpcEffect(
        ORCHESTRATION_WS_METHODS.dispatchCommand,
        Effect.gen(function* () {
          const normalizedCommand = yield* normalizeDispatchCommand(command);
          const shouldStopSessionAfterArchive =
            normalizedCommand.type === "thread.archive"
              ? yield* projectionSnapshotQuery.getThreadShellById(normalizedCommand.threadId).pipe(
                  Effect.map(
                    Option.match({
                      onNone: () => false,
                      onSome: (thread) =>
                        thread.session !== null && thread.session.status !== "stopped",
                    }),
                  ),
                  Effect.orElseSucceed(() => false),
                )
              : false;
          const result = yield* dispatchNormalizedCommand(normalizedCommand);
          if (normalizedCommand.type === "thread.archive") {
            if (shouldStopSessionAfterArchive) {
              yield* Effect.gen(function* () {
                const stopCommand = yield* normalizeDispatchCommand({
                  type: "thread.session.stop",
                  commandId: CommandId.make(
                    `session-stop-for-archive:${normalizedCommand.commandId}`,
                  ),
                  threadId: normalizedCommand.threadId,
                  createdAt: yield* nowIso,
                });

                yield* dispatchNormalizedCommand(stopCommand);
              }).pipe(
                Effect.catchCause((cause) =>
                  Effect.logWarning("failed to stop provider session during archive", {
                    threadId: normalizedCommand.threadId,
                    cause,
                  }),
                ),
              );
            }

            yield* terminalManager.close({ threadId: normalizedCommand.threadId }).pipe(
              Effect.catch((error) =>
                Effect.logWarning("failed to close thread terminals after archive", {
                  threadId: normalizedCommand.threadId,
                  error: error.message,
                }),
              ),
            );
          }
          return result;
        }).pipe(
          Effect.mapError((cause) =>
            isOrchestrationDispatchCommandError(cause)
              ? cause
              : new OrchestrationDispatchCommandError({
                  message: "Failed to dispatch orchestration command",
                  cause,
                }),
          ),
        ),
        { "rpc.aggregate": "orchestration" },
      ),
    [ORCHESTRATION_WS_METHODS.getTurnDiff]: (input) =>
      observeRpcEffect(
        ORCHESTRATION_WS_METHODS.getTurnDiff,
        checkpointDiffQuery.getTurnDiff(input).pipe(
          Effect.mapError(
            (cause) =>
              new OrchestrationGetTurnDiffError({
                message: "Failed to load turn diff",
                cause,
              }),
          ),
        ),
        { "rpc.aggregate": "orchestration" },
      ),
    [ORCHESTRATION_WS_METHODS.getFullThreadDiff]: (input) =>
      observeRpcEffect(
        ORCHESTRATION_WS_METHODS.getFullThreadDiff,
        checkpointDiffQuery.getFullThreadDiff(input).pipe(
          Effect.mapError(
            (cause) =>
              new OrchestrationGetFullThreadDiffError({
                message: "Failed to load full thread diff",
                cause,
              }),
          ),
        ),
        { "rpc.aggregate": "orchestration" },
      ),
    [ORCHESTRATION_WS_METHODS.replayEvents]: (input) =>
      observeRpcEffect(
        ORCHESTRATION_WS_METHODS.replayEvents,
        Stream.runCollect(
          orchestrationEngine.readEvents(
            clamp(input.fromSequenceExclusive, {
              maximum: Number.MAX_SAFE_INTEGER,
              minimum: 0,
            }),
          ),
        ).pipe(
          Effect.map((events) => Array.from(events)),
          Effect.flatMap(enrichOrchestrationEvents),
          Effect.mapError(
            (cause) =>
              new OrchestrationReplayEventsError({
                message: "Failed to replay orchestration events",
                cause,
              }),
          ),
        ),
        { "rpc.aggregate": "orchestration" },
      ),
    [ORCHESTRATION_WS_METHODS.subscribeShell]: (input) =>
      observeRpcStreamEffect(
        ORCHESTRATION_WS_METHODS.subscribeShell,
        Effect.gen(function* () {
          const liveStream = orchestrationEngine.streamDomainEvents.pipe(
            Stream.mapEffect(toShellStreamEvent),
            Stream.flatMap((event) =>
              Option.isSome(event) ? Stream.succeed(event.value) : Stream.empty,
            ),
          );

          // When the client already holds a shell snapshot (cached, or loaded
          // over HTTP) it passes that snapshot's sequence, and we resume by
          // replaying shell events after it instead of re-sending the whole
          // projects/threads list over the socket. As in the thread path, the
          // live subscription is attached (into a scope-bound buffer) before
          // draining the catch-up replay so no event published during the
          // replay window is lost; overlapping events are deduped by sequence
          // on the client. The full range is read (not the store's default
          // page limit) since the shell filter runs after reading.
          if (input.afterSequence !== undefined) {
            const afterSequence = input.afterSequence;
            return Stream.unwrap(
              Effect.gen(function* () {
                const liveBuffer = yield* Queue.unbounded<OrchestrationShellStreamItem>();
                yield* Effect.forkScoped(
                  liveStream.pipe(Stream.runForEach((item) => Queue.offer(liveBuffer, item))),
                );
                const catchUpStream = orchestrationEngine
                  .readEvents(afterSequence, Number.MAX_SAFE_INTEGER)
                  .pipe(
                    Stream.mapEffect(toShellStreamEvent),
                    Stream.flatMap((event) =>
                      Option.isSome(event) ? Stream.succeed(event.value) : Stream.empty,
                    ),
                    Stream.mapError(
                      (cause) =>
                        new OrchestrationGetSnapshotError({
                          message: "Failed to replay orchestration shell events",
                          cause,
                        }),
                    ),
                  );
                return Stream.concat(catchUpStream, Stream.fromQueue(liveBuffer));
              }),
            );
          }

          const snapshot = yield* projectionSnapshotQuery.getShellSnapshot().pipe(
            Effect.tapError((cause) =>
              Effect.logError("orchestration shell snapshot load failed", { cause }),
            ),
            Effect.mapError(
              (cause) =>
                new OrchestrationGetSnapshotError({
                  message: "Failed to load orchestration shell snapshot",
                  cause,
                }),
            ),
          );

          return Stream.concat(
            Stream.make({
              kind: "snapshot" as const,
              snapshot,
            }),
            liveStream,
          );
        }),
        { "rpc.aggregate": "orchestration" },
      ),
    [ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot]: (_input) =>
      observeRpcEffect(
        ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot,
        projectionSnapshotQuery.getArchivedShellSnapshot().pipe(
          Effect.tapError((cause) =>
            Effect.logError("orchestration archived shell snapshot load failed", { cause }),
          ),
          Effect.mapError(
            (cause) =>
              new OrchestrationGetSnapshotError({
                message: "Failed to load archived orchestration shell snapshot",
                cause,
              }),
          ),
        ),
        { "rpc.aggregate": "orchestration" },
      ),
    [ORCHESTRATION_WS_METHODS.subscribeThread]: (input) =>
      observeRpcStreamEffect(
        ORCHESTRATION_WS_METHODS.subscribeThread,
        Effect.gen(function* () {
          const isThisThreadDetailEvent = (event: OrchestrationEvent) =>
            event.aggregateKind === "thread" &&
            event.aggregateId === input.threadId &&
            isThreadDetailEvent(event);

          const liveStream = orchestrationEngine.streamDomainEvents.pipe(
            Stream.filter(isThisThreadDetailEvent),
            Stream.map((event) => ({
              kind: "event" as const,
              event,
            })),
          );

          // Attach live delivery before reading either replay or snapshot state.
          // Otherwise an event published while the snapshot is loading is lost.
          const liveBuffer = yield* Queue.unbounded<OrchestrationThreadStreamItem>();
          yield* Effect.forkScoped(
            liveStream.pipe(Stream.runForEach((item) => Queue.offer(liveBuffer, item))),
          );
          const bufferedLiveStream = Stream.fromQueue(liveBuffer);

          // When the client already loaded the snapshot over HTTP it passes
          // that snapshot's sequence, and we resume the live subscription by
          // replaying persisted events after it instead of re-sending the
          // (potentially multi-KB) snapshot frame over the socket.
          //
          // The live PubSub subscription must be attached *before* draining
          // the catch-up replay, otherwise events published during the replay
          // window are dropped (they are past the persisted tail the replay
          // read, but the live stream is not yet subscribed). So fork the
          // live stream into a buffer bound to this stream's scope, then emit
          // catch-up followed by the buffered/ongoing live events. Overlapping
          // events are deduped by sequence on the client.
          //
          // Read the full range after the cursor (not the store's default
          // page-bounded limit): the range is normally tiny (a fresh HTTP
          // snapshot sequence) and the per-thread filter runs after reading,
          // so a global cap could otherwise omit this thread's events.
          if (input.afterSequence !== undefined) {
            const afterSequence = input.afterSequence;
            const catchUpStream = orchestrationEngine
              .readEvents(afterSequence, Number.MAX_SAFE_INTEGER)
              .pipe(
                Stream.filter(isThisThreadDetailEvent),
                Stream.map((event) => ({ kind: "event" as const, event })),
                Stream.mapError(
                  (cause) =>
                    new OrchestrationGetSnapshotError({
                      message: `Failed to replay thread ${input.threadId} events`,
                      cause,
                    }),
                ),
              );
            return Stream.concat(catchUpStream, bufferedLiveStream);
          }

          const snapshot = yield* projectionSnapshotQuery
            .getThreadDetailSnapshot(input.threadId)
            .pipe(
              Effect.mapError(
                (cause) =>
                  new OrchestrationGetSnapshotError({
                    message: `Failed to load thread ${input.threadId}`,
                    cause,
                  }),
              ),
            );

          if (Option.isNone(snapshot)) {
            return yield* new OrchestrationGetSnapshotError({
              message: `Thread ${input.threadId} was not found`,
              cause: input.threadId,
            });
          }

          return Stream.concat(
            Stream.make({
              kind: "snapshot" as const,
              snapshot: snapshot.value,
            }),
            bufferedLiveStream,
          );
        }),
        { "rpc.aggregate": "orchestration" },
      ),
  });
}
