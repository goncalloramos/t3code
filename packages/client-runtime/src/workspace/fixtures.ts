import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationProjectShell,
  type OrchestrationShellSnapshot,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";

import type { WorkspaceConnectionPhase, WorkspaceEnvironmentInput } from "./model.ts";

const FIXTURE_TIME = "2026-07-20T12:00:00.000Z";

export function makeWorkspaceProjectFixture(
  id: string,
  input: Partial<OrchestrationProjectShell> = {},
): OrchestrationProjectShell {
  return {
    id: ProjectId.make(id),
    title: `Project ${id}`,
    workspaceRoot: `/workspace/${id}`,
    defaultModelSelection: null,
    scripts: [],
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
    ...input,
  };
}

export function makeWorkspaceThreadFixture(
  id: string,
  projectId: ProjectId,
  input: Partial<OrchestrationThreadShell> = {},
): OrchestrationThreadShell {
  return {
    id: ThreadId.make(id),
    projectId,
    title: `Thread ${id}`,
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: "main",
    worktreePath: null,
    latestTurn: null,
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
    archivedAt: null,
    session: null,
    latestUserMessageAt: FIXTURE_TIME,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...input,
  };
}

export function makeWorkspaceEnvironmentFixture(
  input: {
    readonly environmentId?: string;
    readonly label?: string;
    readonly phase?: WorkspaceConnectionPhase;
    readonly snapshotSequence?: number;
    readonly projects?: ReadonlyArray<OrchestrationProjectShell>;
    readonly threads?: ReadonlyArray<OrchestrationThreadShell>;
  } = {},
): WorkspaceEnvironmentInput {
  const environmentId = EnvironmentId.make(input.environmentId ?? "environment-1");
  const snapshot: OrchestrationShellSnapshot = {
    snapshotSequence: input.snapshotSequence ?? 1,
    projects: [...(input.projects ?? [])],
    threads: [...(input.threads ?? [])],
    updatedAt: FIXTURE_TIME,
  };
  return {
    connection: {
      environmentId,
      label: input.label ?? "Test environment",
      phase: input.phase ?? "live",
      hasSnapshot: true,
      error: null,
      snapshotUpdatedAt: FIXTURE_TIME,
      retryAt: null,
    },
    snapshot,
  };
}

export function makeRunningWorkspaceThread(
  id: string,
  projectId: ProjectId,
): OrchestrationThreadShell {
  const threadId = ThreadId.make(id);
  const turnId = TurnId.make(`${id}-turn`);
  return makeWorkspaceThreadFixture(id, projectId, {
    latestTurn: {
      turnId,
      state: "running",
      requestedAt: FIXTURE_TIME,
      startedAt: FIXTURE_TIME,
      completedAt: null,
      assistantMessageId: null,
    },
    session: {
      threadId,
      status: "running",
      providerName: "codex",
      runtimeMode: "full-access",
      activeTurnId: turnId,
      lastError: null,
      updatedAt: FIXTURE_TIME,
    },
  });
}
