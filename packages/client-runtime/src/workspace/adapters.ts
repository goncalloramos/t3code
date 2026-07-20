import type { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";

import type { ConnectionCatalogEntry } from "../connection/catalog.ts";
import type { SupervisorConnectionState } from "../connection/model.ts";
import type { EnvironmentShellState } from "../state/shell.ts";
import type {
  WorkspaceConnectionPhase,
  WorkspaceConnectionSummary,
  WorkspaceEnvironmentInput,
} from "./model.ts";

export interface WorkspaceEnvironmentSnapshotSource {
  readonly entry: ConnectionCatalogEntry;
  readonly connection: SupervisorConnectionState;
  readonly shell: EnvironmentShellState;
}

function workspaceConnectionPhase(
  connection: SupervisorConnectionState,
  shell: EnvironmentShellState,
): WorkspaceConnectionPhase {
  switch (connection.phase) {
    case "available":
      return Option.isSome(shell.snapshot) ? "stale" : "available";
    case "offline":
      return "offline";
    case "connecting":
      return connection.attempt <= 1 && connection.lastFailure === null
        ? "connecting"
        : "reconnecting";
    case "backoff":
      return "reconnecting";
    case "connected":
      if (shell.status === "live") return "live";
      return Option.isSome(shell.snapshot) ? "stale" : "connecting";
    case "blocked":
      return connection.lastFailure?.reason === "authentication"
        ? "authentication-error"
        : "unavailable";
  }
}

export function adaptWorkspaceConnection(
  source: WorkspaceEnvironmentSnapshotSource,
): WorkspaceConnectionSummary {
  const snapshot = Option.getOrNull(source.shell.snapshot);
  return {
    environmentId: source.entry.target.environmentId,
    label: source.entry.target.label,
    phase: workspaceConnectionPhase(source.connection, source.shell),
    hasSnapshot: snapshot !== null,
    error: source.connection.lastFailure?.message ?? Option.getOrNull(source.shell.error),
    snapshotUpdatedAt: snapshot?.updatedAt ?? null,
    retryAt: source.connection.retryAt,
  };
}

export function adaptWorkspaceEnvironment(
  source: WorkspaceEnvironmentSnapshotSource,
): WorkspaceEnvironmentInput {
  return {
    connection: adaptWorkspaceConnection(source),
    snapshot: Option.getOrNull(source.shell.snapshot),
  };
}

export function adaptWorkspaceEnvironments(input: {
  readonly entries: ReadonlyMap<EnvironmentId, ConnectionCatalogEntry>;
  readonly connectionFor: (environmentId: EnvironmentId) => SupervisorConnectionState;
  readonly shellFor: (environmentId: EnvironmentId) => EnvironmentShellState;
}): ReadonlyArray<WorkspaceEnvironmentInput> {
  return Array.from(input.entries, ([environmentId, entry]) =>
    adaptWorkspaceEnvironment({
      entry,
      connection: input.connectionFor(environmentId),
      shell: input.shellFor(environmentId),
    }),
  );
}
