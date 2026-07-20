import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  type OrchestrationShellSnapshot,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";
import { describe, expect, it } from "vite-plus/test";

import type { ConnectionCatalogEntry } from "../connection/catalog.ts";
import {
  AVAILABLE_CONNECTION_STATE,
  ConnectionTransientError,
  PrimaryConnectionTarget,
  type SupervisorConnectionState,
} from "../connection/model.ts";
import type { EnvironmentCatalogState } from "../state/connections.ts";
import type { EnvironmentShellState } from "../state/shell.ts";
import { createWorkspaceAtoms } from "./atoms.ts";
import {
  makeWorkspaceEnvironmentFixture,
  makeWorkspaceProjectFixture,
  makeWorkspaceThreadFixture,
} from "./fixtures.ts";

const localId = EnvironmentId.make("local");
const remoteId = EnvironmentId.make("remote");
const projectId = ProjectId.make("project-1");
const threadId = ThreadId.make("thread-1");

function catalogEntry(environmentId: EnvironmentId, label: string): ConnectionCatalogEntry {
  return {
    target: new PrimaryConnectionTarget({
      environmentId,
      label,
      httpBaseUrl: `http://${environmentId}.test`,
      wsBaseUrl: `ws://${environmentId}.test`,
    }),
    profile: Option.none(),
  };
}

function shellState(snapshot: OrchestrationShellSnapshot): EnvironmentShellState {
  return { snapshot: Option.some(snapshot), status: "live", error: Option.none() };
}

function makeHarness() {
  const project = makeWorkspaceProjectFixture(projectId);
  const thread = makeWorkspaceThreadFixture(threadId, project.id);
  const localSnapshot = makeWorkspaceEnvironmentFixture({
    environmentId: localId,
    projects: [project],
    threads: [thread],
  }).snapshot!;
  const remoteSnapshot = makeWorkspaceEnvironmentFixture({
    environmentId: remoteId,
    projects: [project],
    threads: [thread],
  }).snapshot!;
  const catalogAtom = Atom.make<EnvironmentCatalogState>({
    isReady: true,
    entries: new Map([
      [localId, catalogEntry(localId, "Local")],
      [remoteId, catalogEntry(remoteId, "Remote")],
    ]),
  });
  const connectionAtoms = new Map([
    [
      localId,
      Atom.make(
        AsyncResult.success<SupervisorConnectionState>({
          ...AVAILABLE_CONNECTION_STATE,
          desired: true,
          phase: "connected",
        }),
      ),
    ],
    [
      remoteId,
      Atom.make(
        AsyncResult.success<SupervisorConnectionState>({
          ...AVAILABLE_CONNECTION_STATE,
          desired: true,
          phase: "connected",
        }),
      ),
    ],
  ]);
  const shellAtoms = new Map([
    [localId, Atom.make(shellState(localSnapshot))],
    [remoteId, Atom.make(shellState(remoteSnapshot))],
  ]);
  const atoms = createWorkspaceAtoms({
    catalogValueAtom: catalogAtom,
    connectionStateAtom: (environmentId) => connectionAtoms.get(environmentId)!,
    shellStateValueAtom: (environmentId) => shellAtoms.get(environmentId)!,
  });
  return {
    atoms,
    registry: AtomRegistry.make(),
    connectionAtoms,
    shellAtoms,
    localSnapshot,
  };
}

describe("workspace atoms", () => {
  it("projects one kept-alive read model from catalog, connection, and shell atoms", () => {
    const { atoms, registry } = makeHarness();
    const model = registry.get(atoms.workspaceAtom);

    expect(model.connections.map((connection) => connection.phase)).toEqual(["live", "live"]);
    expect(model.projects).toHaveLength(2);
    expect(model.threads).toHaveLength(2);
  });

  it("memoizes structurally equivalent scoped selectors and preserves environment identity", () => {
    const { atoms, registry } = makeHarness();
    const localRef = { environmentId: localId, projectId };
    const equivalentLocalRef = { environmentId: localId, projectId };
    const remoteRef = { environmentId: remoteId, projectId };

    expect(atoms.projectAtom(localRef)).toBe(atoms.projectAtom(equivalentLocalRef));
    expect(atoms.projectAtom(localRef)).not.toBe(atoms.projectAtom(remoteRef));
    expect(registry.get(atoms.projectAtom(localRef))?.environmentId).toBe(localId);
    expect(registry.get(atoms.projectAtom(remoteRef))?.environmentId).toBe(remoteId);
    expect(
      registry.get(atoms.threadAtom({ environmentId: remoteId, threadId }))?.environmentId,
    ).toBe(remoteId);
    expect(atoms.projectThreadsForRefsAtom([localRef, remoteRef])).toBe(
      atoms.projectThreadsForRefsAtom([equivalentLocalRef, remoteRef]),
    );
    expect(
      registry
        .get(atoms.projectThreadsForRefsAtom([localRef, remoteRef]))
        .map((thread) => thread.environmentId),
    ).toEqual([localId, remoteId]);
  });

  it("normalizes writable selection through the shared read model", () => {
    const { atoms, registry } = makeHarness();
    registry.set(atoms.selectionAtom, {
      environmentId: remoteId,
      projectId: null,
      threadId,
    });

    expect(registry.get(atoms.workspaceAtom).selection).toEqual({
      environmentId: remoteId,
      projectId,
      threadId,
    });
    expect(registry.get(atoms.selectedProjectAtom)?.environmentId).toBe(remoteId);
    expect(registry.get(atoms.selectedThreadAtom)?.id).toBe(threadId);
  });

  it("keeps the last shell snapshot while a connection becomes stale", () => {
    const { atoms, registry, connectionAtoms, localSnapshot } = makeHarness();
    registry.set(
      connectionAtoms.get(localId)!,
      AsyncResult.success({
        ...AVAILABLE_CONNECTION_STATE,
        desired: true,
        phase: "backoff",
        attempt: 2,
        retryAt: 42,
        lastFailure: new ConnectionTransientError({
          reason: "transport",
          detail: "Socket closed",
        }),
      }),
    );

    const model = registry.get(atoms.workspaceAtom);
    expect(model.projects.find((project) => project.environmentId === localId)?.id).toBe(projectId);
    expect(model.connections.find((connection) => connection.environmentId === localId)).toEqual(
      expect.objectContaining({ phase: "reconnecting", hasSnapshot: true, retryAt: 42 }),
    );
    expect(localSnapshot.projects[0]?.id).toBe(projectId);
  });
});
