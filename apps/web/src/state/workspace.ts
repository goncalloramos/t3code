import { useAtomValue } from "@effect/atom-react";
import {
  createWorkspaceAtoms,
  createWorkspaceCommandScheduler,
  type WorkspaceConnectionSummary,
  type WorkspaceProject,
  type WorkspaceThread,
} from "@t3tools/client-runtime/workspace";
import type { EnvironmentId, ScopedProjectRef, ScopedThreadRef } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";
import { appAtomRegistry } from "../rpc/atomRegistry";

import { environmentCatalog } from "../connection/catalog";
import { connectionAtomRuntime } from "../connection/runtime";
import { environmentShell } from "./shell";

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
  Atom.withLabel("web-workspace-project:empty"),
);
const EMPTY_THREAD_ATOM = Atom.make<WorkspaceThread | null>(null).pipe(
  Atom.withLabel("web-workspace-thread:empty"),
);
const EMPTY_PROJECT_THREADS_ATOM = Atom.make<ReadonlyArray<WorkspaceThread>>([]).pipe(
  Atom.withLabel("web-workspace-project-threads:empty"),
);
const EMPTY_CONNECTION_ATOM = Atom.make<WorkspaceConnectionSummary | null>(null).pipe(
  Atom.withLabel("web-workspace-connection:empty"),
);

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

export function useWorkspaceConnection(
  environmentId: EnvironmentId | null,
): WorkspaceConnectionSummary | null {
  return useAtomValue(
    environmentId === null ? EMPTY_CONNECTION_ATOM : workspaceAtoms.connectionAtom(environmentId),
  );
}

export function useWorkspaceProjects(): ReadonlyArray<WorkspaceProject> {
  return useAtomValue(workspaceAtoms.workspaceAtom).projects;
}

export function useWorkspaceThreads(): ReadonlyArray<WorkspaceThread> {
  return useAtomValue(workspaceAtoms.workspaceAtom).threads;
}

export function useWorkspaceThreadsForProjectRefs(
  refs: ReadonlyArray<ScopedProjectRef>,
): ReadonlyArray<WorkspaceThread> {
  return useAtomValue(workspaceAtoms.projectThreadsForRefsAtom(refs));
}

export function readWorkspaceThread(ref: ScopedThreadRef): WorkspaceThread | null {
  return appAtomRegistry.get(workspaceAtoms.threadAtom(ref));
}
