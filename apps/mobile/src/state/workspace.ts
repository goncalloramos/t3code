import { useAtomValue } from "@effect/atom-react";
import {
  createWorkspaceAtoms,
  createWorkspaceCommandScheduler,
  type WorkspaceCommand,
  type WorkspaceProject,
  type WorkspaceThread,
} from "@t3tools/client-runtime/workspace";
import type { ScopedProjectRef, ScopedThreadRef } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";
import { useMemo } from "react";

import { environmentCatalog } from "../connection/catalog";
import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "./atom-registry";
import { environmentShell, environmentShellSummaryAtom } from "./shell";
import { projectWorkspaceEnvironment, projectWorkspaceState } from "./workspaceModel";
import { useEnvironments } from "./environments";

export const workspaceAtoms = createWorkspaceAtoms({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  connectionStateAtom: environmentCatalog.stateAtom,
  shellStateValueAtom: environmentShell.stateValueAtom,
});

export const workspaceCommands = createWorkspaceCommandScheduler(
  connectionAtomRuntime,
  workspaceAtoms.selectionAtom,
);

const EMPTY_PROJECT_ATOM = Atom.make<WorkspaceProject | null>(null).pipe(
  Atom.withLabel("mobile-workspace-project:empty"),
);
const EMPTY_THREAD_ATOM = Atom.make<WorkspaceThread | null>(null).pipe(
  Atom.withLabel("mobile-workspace-thread:empty"),
);
const EMPTY_PROJECT_THREADS_ATOM = Atom.make<ReadonlyArray<WorkspaceThread>>([]).pipe(
  Atom.withLabel("mobile-workspace-project-threads:empty"),
);

export function useWorkspaceProjects(): ReadonlyArray<WorkspaceProject> {
  return useAtomValue(workspaceAtoms.workspaceAtom).projects;
}

export function useWorkspaceThreads(): ReadonlyArray<WorkspaceThread> {
  return useAtomValue(workspaceAtoms.workspaceAtom).threads;
}

export function useWorkspaceProject(ref: ScopedProjectRef | null): WorkspaceProject | null {
  return useAtomValue(ref === null ? EMPTY_PROJECT_ATOM : workspaceAtoms.projectAtom(ref));
}

export function useWorkspaceThread(ref: ScopedThreadRef | null): WorkspaceThread | null {
  return useAtomValue(ref === null ? EMPTY_THREAD_ATOM : workspaceAtoms.threadAtom(ref));
}

export function useWorkspaceProjectThreads(
  ref: ScopedProjectRef | null,
): ReadonlyArray<WorkspaceThread> {
  return useAtomValue(
    ref === null ? EMPTY_PROJECT_THREADS_ATOM : workspaceAtoms.projectThreadsAtom(ref),
  );
}

export function runWorkspaceCommand(command: WorkspaceCommand) {
  return workspaceCommands.run(appAtomRegistry, command);
}

export function useWorkspaceState() {
  const { isReady, networkStatus, environments } = useEnvironments();
  const shellSummary = useAtomValue(environmentShellSummaryAtom);
  const projectedEnvironments = useMemo(
    () => environments.map(projectWorkspaceEnvironment),
    [environments],
  );
  const state = useMemo(
    () =>
      projectWorkspaceState({
        isReady,
        networkStatus,
        environments: projectedEnvironments,
        shellSummary,
      }),
    [isReady, networkStatus, projectedEnvironments, shellSummary],
  );

  return {
    environments: projectedEnvironments,
    state,
  };
}
