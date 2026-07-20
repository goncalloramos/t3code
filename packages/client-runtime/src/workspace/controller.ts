import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";

import { buildWorkspaceReadModel } from "./selectors.ts";
import {
  EMPTY_WORKSPACE_SELECTION,
  type WorkspaceConnectionSummary,
  type WorkspaceEnvironmentInput,
  type WorkspaceReadModel,
  type WorkspaceSelection,
} from "./model.ts";

export interface WorkspaceControllerState {
  readonly environments: ReadonlyMap<EnvironmentId, WorkspaceEnvironmentInput>;
  readonly selection: WorkspaceSelection;
  readonly model: WorkspaceReadModel;
}

export type WorkspaceControllerEvent =
  | { readonly _tag: "EnvironmentUpdated"; readonly environment: WorkspaceEnvironmentInput }
  | { readonly _tag: "EnvironmentRemoved"; readonly environmentId: EnvironmentId }
  | {
      readonly _tag: "ConnectionUpdated";
      readonly connection: WorkspaceConnectionSummary;
    }
  | {
      readonly _tag: "ProjectSelected";
      readonly environmentId: EnvironmentId;
      readonly projectId: ProjectId;
    }
  | {
      readonly _tag: "ThreadSelected";
      readonly environmentId: EnvironmentId;
      readonly threadId: ThreadId;
    }
  | { readonly _tag: "SelectionCleared" };

function rebuild(
  environments: ReadonlyMap<EnvironmentId, WorkspaceEnvironmentInput>,
  selection: WorkspaceSelection,
): WorkspaceControllerState {
  const model = buildWorkspaceReadModel({ environments: [...environments.values()], selection });
  return { environments, selection: model.selection, model };
}

export function createWorkspaceControllerState(
  environments: ReadonlyArray<WorkspaceEnvironmentInput> = [],
): WorkspaceControllerState {
  return rebuild(
    new Map(environments.map((environment) => [environment.connection.environmentId, environment])),
    EMPTY_WORKSPACE_SELECTION,
  );
}

export function reduceWorkspaceController(
  state: WorkspaceControllerState,
  event: WorkspaceControllerEvent,
): WorkspaceControllerState {
  switch (event._tag) {
    case "EnvironmentUpdated": {
      const environments = new Map(state.environments);
      environments.set(event.environment.connection.environmentId, event.environment);
      return rebuild(environments, state.selection);
    }
    case "EnvironmentRemoved": {
      const environments = new Map(state.environments);
      environments.delete(event.environmentId);
      return rebuild(environments, state.selection);
    }
    case "ConnectionUpdated": {
      const current = state.environments.get(event.connection.environmentId);
      if (!current) return state;
      const environments = new Map(state.environments);
      environments.set(event.connection.environmentId, {
        ...current,
        connection: event.connection,
      });
      return rebuild(environments, state.selection);
    }
    case "ProjectSelected":
      return rebuild(state.environments, {
        environmentId: event.environmentId,
        projectId: event.projectId,
        threadId: null,
      });
    case "ThreadSelected":
      return rebuild(state.environments, {
        environmentId: event.environmentId,
        projectId: null,
        threadId: event.threadId,
      });
    case "SelectionCleared":
      return rebuild(state.environments, EMPTY_WORKSPACE_SELECTION);
  }
}
