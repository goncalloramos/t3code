import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";

import { projectWorkspaceAttention } from "./attention.ts";
import {
  EMPTY_WORKSPACE_SELECTION,
  type WorkspaceAgentState,
  type WorkspaceEnvironmentInput,
  type WorkspaceProject,
  type WorkspaceReadModel,
  type WorkspaceSelection,
  type WorkspaceThread,
} from "./model.ts";

export function workspaceAgentState(thread: {
  readonly hasPendingApprovals: boolean;
  readonly hasPendingUserInput: boolean;
  readonly session: { readonly status: string } | null;
  readonly latestTurn: { readonly state: string } | null;
}): WorkspaceAgentState {
  if (thread.hasPendingApprovals || thread.hasPendingUserInput) return "waiting";
  if (thread.session?.status === "running" || thread.session?.status === "starting")
    return "active";
  if (thread.session?.status === "error" || thread.latestTurn?.state === "error") return "failed";
  if (thread.latestTurn?.state === "completed") return "completed";
  return "idle";
}

export function normalizeWorkspaceSelection(
  selection: WorkspaceSelection,
  projects: ReadonlyArray<WorkspaceProject>,
  threads: ReadonlyArray<WorkspaceThread>,
): WorkspaceSelection {
  const selectedThread = threads.find(
    (thread) =>
      thread.environmentId === selection.environmentId && thread.id === selection.threadId,
  );
  if (selectedThread) {
    return {
      environmentId: selectedThread.environmentId,
      projectId: selectedThread.projectId,
      threadId: selectedThread.id,
    };
  }
  const selectedProject = projects.find(
    (project) =>
      project.environmentId === selection.environmentId && project.id === selection.projectId,
  );
  if (selectedProject) {
    return {
      environmentId: selectedProject.environmentId,
      projectId: selectedProject.id,
      threadId: null,
    };
  }
  return EMPTY_WORKSPACE_SELECTION;
}

export function buildWorkspaceReadModel(input: {
  readonly environments: ReadonlyArray<WorkspaceEnvironmentInput>;
  readonly selection?: WorkspaceSelection;
}): WorkspaceReadModel {
  const connections = input.environments.map(({ connection }) => connection);
  const threads: WorkspaceThread[] = [];
  const projects: WorkspaceProject[] = [];
  let revision = 0;

  for (const environment of input.environments) {
    const snapshot = environment.snapshot;
    if (!snapshot) continue;
    revision = Math.max(revision, snapshot.snapshotSequence);
    const environmentThreads = snapshot.threads.map(
      (thread): WorkspaceThread => ({
        ...thread,
        environmentId: environment.connection.environmentId,
        agentState: workspaceAgentState(thread),
      }),
    );
    threads.push(...environmentThreads);
    for (const project of snapshot.projects) {
      const projectThreads = environmentThreads.filter((thread) => thread.projectId === project.id);
      projects.push({
        ...project,
        environmentId: environment.connection.environmentId,
        connection: environment.connection,
        threadIds: projectThreads.map((thread) => thread.id),
        activeThreadCount: projectThreads.filter((thread) => thread.agentState === "active").length,
        waitingThreadCount: projectThreads.filter((thread) => thread.agentState === "waiting")
          .length,
        failedThreadCount: projectThreads.filter((thread) => thread.agentState === "failed").length,
      });
    }
  }

  projects.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  threads.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const selection = normalizeWorkspaceSelection(
    input.selection ?? EMPTY_WORKSPACE_SELECTION,
    projects,
    threads,
  );
  return {
    revision,
    connections,
    projects,
    threads,
    attention: projectWorkspaceAttention(threads),
    selection,
    isStale: connections.some((connection) =>
      ["stale", "offline", "reconnecting"].includes(connection.phase),
    ),
  };
}

export function selectWorkspaceProject(
  model: WorkspaceReadModel,
  environmentId: EnvironmentId,
  projectId: ProjectId,
): WorkspaceProject | null {
  return (
    model.projects.find(
      (project) => project.environmentId === environmentId && project.id === projectId,
    ) ?? null
  );
}

export function selectWorkspaceThread(
  model: WorkspaceReadModel,
  environmentId: EnvironmentId,
  threadId: ThreadId,
): WorkspaceThread | null {
  return (
    model.threads.find(
      (thread) => thread.environmentId === environmentId && thread.id === threadId,
    ) ?? null
  );
}

export function selectProjectThreads(
  model: WorkspaceReadModel,
  environmentId: EnvironmentId,
  projectId: ProjectId,
): ReadonlyArray<WorkspaceThread> {
  return model.threads.filter(
    (thread) => thread.environmentId === environmentId && thread.projectId === projectId,
  );
}
