import type {
  EnvironmentId,
  OrchestrationProjectShell,
  OrchestrationShellSnapshot,
  OrchestrationThreadShell,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";

export type WorkspaceConnectionPhase =
  | "available"
  | "connecting"
  | "reconnecting"
  | "live"
  | "stale"
  | "offline"
  | "authentication-error"
  | "unavailable";

export interface WorkspaceConnectionSummary {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly phase: WorkspaceConnectionPhase;
  readonly hasSnapshot: boolean;
  readonly error: string | null;
  readonly snapshotUpdatedAt: string | null;
  readonly retryAt: number | null;
}

export type WorkspaceAgentState = "idle" | "active" | "waiting" | "failed" | "completed";

export interface WorkspaceThread extends OrchestrationThreadShell {
  readonly environmentId: EnvironmentId;
  readonly agentState: WorkspaceAgentState;
}

export interface WorkspaceProject extends OrchestrationProjectShell {
  readonly environmentId: EnvironmentId;
  readonly connection: WorkspaceConnectionSummary;
  readonly threadIds: ReadonlyArray<ThreadId>;
  readonly activeThreadCount: number;
  readonly waitingThreadCount: number;
  readonly failedThreadCount: number;
}

export type WorkspaceAttentionKind =
  | "approval"
  | "user-input"
  | "plan-ready"
  | "failed"
  | "running"
  | "completed";

export interface WorkspaceAttentionItem {
  readonly id: string;
  readonly kind: WorkspaceAttentionKind;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
  readonly title: string;
  readonly occurredAt: string;
  readonly priority: number;
}

export interface WorkspaceSelection {
  readonly environmentId: EnvironmentId | null;
  readonly projectId: ProjectId | null;
  readonly threadId: ThreadId | null;
}

export const EMPTY_WORKSPACE_SELECTION: WorkspaceSelection = Object.freeze({
  environmentId: null,
  projectId: null,
  threadId: null,
});

export interface WorkspaceReadModel {
  readonly revision: number;
  readonly connections: ReadonlyArray<WorkspaceConnectionSummary>;
  readonly projects: ReadonlyArray<WorkspaceProject>;
  readonly threads: ReadonlyArray<WorkspaceThread>;
  readonly attention: ReadonlyArray<WorkspaceAttentionItem>;
  readonly selection: WorkspaceSelection;
  readonly isStale: boolean;
}

export interface WorkspaceEnvironmentInput {
  readonly connection: WorkspaceConnectionSummary;
  readonly snapshot: OrchestrationShellSnapshot | null;
}
