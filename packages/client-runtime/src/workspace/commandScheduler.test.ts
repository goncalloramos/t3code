import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

import type { AtomCommandResult } from "../state/runtime.ts";
import { WorkspaceCommands } from "./commands.ts";
import { createWorkspaceCommandRouter, type WorkspaceCommandTargets } from "./commandScheduler.ts";
import { EMPTY_WORKSPACE_SELECTION } from "./model.ts";

function makeCommand(
  run = vi.fn(
    (): Promise<AtomCommandResult<unknown, unknown>> =>
      Promise.resolve(AsyncResult.success({ sequence: 1 })),
  ),
) {
  return { run };
}

function makeHarness() {
  const selectionAtom = Atom.make(EMPTY_WORKSPACE_SELECTION);
  const targets = {
    selectionAtom,
    projects: {
      create: makeCommand(),
      update: makeCommand(),
      delete: makeCommand(),
    },
    threads: {
      archive: makeCommand(),
      unarchive: makeCommand(),
      updateMetadata: makeCommand(),
      delete: makeCommand(),
    },
  } satisfies WorkspaceCommandTargets;
  return {
    registry: AtomRegistry.make(),
    router: createWorkspaceCommandRouter(targets),
    selectionAtom,
    targets,
  };
}

const environmentId = EnvironmentId.make("remote");
const projectId = ProjectId.make("project-1");
const threadId = ThreadId.make("thread-1");

describe("workspace command scheduler", () => {
  it("updates selection locally without dispatching an environment mutation", async () => {
    const { registry, router, selectionAtom, targets } = makeHarness();

    const result = await router.run(
      registry,
      WorkspaceCommands.selectThread(environmentId, threadId),
    );

    expect(result._tag).toBe("Success");
    expect(registry.get(selectionAtom)).toEqual({
      environmentId,
      projectId: null,
      threadId,
    });
    expect(targets.threads.updateMetadata.run).not.toHaveBeenCalled();
  });

  it("routes project creation with its environment identity and explicit project id", async () => {
    const { registry, router, targets } = makeHarness();

    await router.run(
      registry,
      WorkspaceCommands.createProject(environmentId, projectId, "T3", "/repo/t3"),
    );

    expect(targets.projects.create.run).toHaveBeenCalledWith(registry, {
      environmentId,
      input: {
        projectId,
        title: "T3",
        workspaceRoot: "/repo/t3",
        createWorkspaceRootIfMissing: true,
      },
    });
  });

  it.each([
    [
      "rename project",
      WorkspaceCommands.renameProject(environmentId, projectId, "Renamed"),
      "update",
    ],
    ["delete project", WorkspaceCommands.deleteProject(environmentId, projectId), "delete"],
    ["archive thread", WorkspaceCommands.archiveThread(environmentId, threadId), "archive"],
    ["restore thread", WorkspaceCommands.restoreThread(environmentId, threadId), "unarchive"],
    [
      "rename thread",
      WorkspaceCommands.renameThread(environmentId, threadId, "Renamed"),
      "updateMetadata",
    ],
    ["delete thread", WorkspaceCommands.deleteThread(environmentId, threadId), "delete"],
  ] as const)("routes %s through the scoped mutation target", async (_name, command, target) => {
    const { registry, router, targets } = makeHarness();

    await router.run(registry, command);

    const group = command._tag.endsWith("Project") ? targets.projects : targets.threads;
    expect(group[target as keyof typeof group].run).toHaveBeenCalledWith(
      registry,
      expect.objectContaining({ environmentId }),
    );
  });

  it("preserves environment interruption as a settled command result", async () => {
    const interrupted = AsyncResult.failure(Cause.interrupt(1));
    const harness = makeHarness();
    harness.targets.threads.archive.run.mockResolvedValue(interrupted);

    const result = await harness.router.run(
      harness.registry,
      WorkspaceCommands.archiveThread(environmentId, threadId),
    );

    expect(result).toBe(interrupted);
    expect(Cause.hasInterruptsOnly(result._tag === "Failure" ? result.cause : Cause.empty)).toBe(
      true,
    );
  });
});
