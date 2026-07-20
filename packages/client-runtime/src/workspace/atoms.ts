import type { EnvironmentId, ScopedProjectRef, ScopedThreadRef } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { AVAILABLE_CONNECTION_STATE, type SupervisorConnectionState } from "../connection/model.ts";
import {
  parseScopedProjectKey,
  parseScopedThreadKey,
  scopedProjectKey,
  scopedThreadKey,
} from "../environment/scoped.ts";
import type { EnvironmentCatalogState } from "../state/connections.ts";
import type { EnvironmentShellState } from "../state/shell.ts";
import { adaptWorkspaceEnvironments } from "./adapters.ts";
import {
  EMPTY_WORKSPACE_SELECTION,
  type WorkspaceAttentionItem,
  type WorkspaceConnectionSummary,
  type WorkspaceProject,
  type WorkspaceReadModel,
  type WorkspaceSelection,
  type WorkspaceThread,
} from "./model.ts";
import {
  buildWorkspaceReadModel,
  selectProjectThreads,
  selectWorkspaceProject,
  selectWorkspaceThread,
} from "./selectors.ts";

export function createWorkspaceAtoms<E>(input: {
  readonly catalogValueAtom: Atom.Atom<EnvironmentCatalogState>;
  readonly connectionStateAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<AsyncResult.AsyncResult<SupervisorConnectionState, E>>;
  readonly shellStateValueAtom: (environmentId: EnvironmentId) => Atom.Atom<EnvironmentShellState>;
}) {
  const selectionAtom = Atom.make<WorkspaceSelection>(EMPTY_WORKSPACE_SELECTION).pipe(
    Atom.keepAlive,
    Atom.withLabel("workspace:selection"),
  );

  const workspaceAtom = Atom.make((get): WorkspaceReadModel => {
    const catalog = get(input.catalogValueAtom);
    const environments = adaptWorkspaceEnvironments({
      entries: catalog.entries,
      connectionFor: (environmentId) =>
        Option.getOrElse(
          AsyncResult.value(get(input.connectionStateAtom(environmentId))),
          () => AVAILABLE_CONNECTION_STATE,
        ),
      shellFor: (environmentId) => get(input.shellStateValueAtom(environmentId)),
    });
    return buildWorkspaceReadModel({ environments, selection: get(selectionAtom) });
  }).pipe(Atom.keepAlive, Atom.withLabel("workspace:read-model"));

  const projectByKeyAtom = Atom.family((key: string) => {
    const ref = parseScopedProjectKey(key);
    if (ref === null) throw new Error(`Invalid scoped workspace project key: ${key}`);
    return Atom.make((get): WorkspaceProject | null =>
      selectWorkspaceProject(get(workspaceAtom), ref.environmentId, ref.projectId),
    ).pipe(Atom.withLabel(`workspace:project:${key}`));
  });
  const threadByKeyAtom = Atom.family((key: string) => {
    const ref = parseScopedThreadKey(key);
    if (ref === null) throw new Error(`Invalid scoped workspace thread key: ${key}`);
    return Atom.make((get): WorkspaceThread | null =>
      selectWorkspaceThread(get(workspaceAtom), ref.environmentId, ref.threadId),
    ).pipe(Atom.withLabel(`workspace:thread:${key}`));
  });
  const projectThreadsByKeyAtom = Atom.family((key: string) => {
    const ref = parseScopedProjectKey(key);
    if (ref === null) throw new Error(`Invalid scoped workspace project key: ${key}`);
    return Atom.make(
      (get): ReadonlyArray<WorkspaceThread> =>
        selectProjectThreads(get(workspaceAtom), ref.environmentId, ref.projectId),
    ).pipe(Atom.withLabel(`workspace:project-threads:${key}`));
  });
  const connectionAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make(
      (get): WorkspaceConnectionSummary | null =>
        get(workspaceAtom).connections.find(
          (connection) => connection.environmentId === environmentId,
        ) ?? null,
    ).pipe(Atom.withLabel(`workspace:connection:${environmentId}`)),
  );

  const selectedProjectAtom = Atom.make((get): WorkspaceProject | null => {
    const model = get(workspaceAtom);
    const selection = model.selection;
    return selection.environmentId !== null && selection.projectId !== null
      ? selectWorkspaceProject(model, selection.environmentId, selection.projectId)
      : null;
  }).pipe(Atom.withLabel("workspace:selected-project"));
  const selectedThreadAtom = Atom.make((get): WorkspaceThread | null => {
    const model = get(workspaceAtom);
    const selection = model.selection;
    return selection.environmentId !== null && selection.threadId !== null
      ? selectWorkspaceThread(model, selection.environmentId, selection.threadId)
      : null;
  }).pipe(Atom.withLabel("workspace:selected-thread"));
  const attentionAtom = Atom.make(
    (get): ReadonlyArray<WorkspaceAttentionItem> => get(workspaceAtom).attention,
  ).pipe(Atom.withLabel("workspace:attention"));

  return {
    workspaceAtom,
    selectionAtom,
    projectAtom: (ref: ScopedProjectRef) => projectByKeyAtom(scopedProjectKey(ref)),
    threadAtom: (ref: ScopedThreadRef) => threadByKeyAtom(scopedThreadKey(ref)),
    projectThreadsAtom: (ref: ScopedProjectRef) => projectThreadsByKeyAtom(scopedProjectKey(ref)),
    connectionAtom,
    selectedProjectAtom,
    selectedThreadAtom,
    attentionAtom,
  } as const;
}
