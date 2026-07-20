import { EnvironmentId, ProjectId, ThreadId, TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { WorkspaceCommands } from "./commands.ts";
import { createWorkspaceControllerState, reduceWorkspaceController } from "./controller.ts";
import {
  makeRunningWorkspaceThread,
  makeWorkspaceEnvironmentFixture,
  makeWorkspaceProjectFixture,
  makeWorkspaceThreadFixture,
} from "./fixtures.ts";
import { buildWorkspaceReadModel, selectWorkspaceThread } from "./selectors.ts";

describe("workspace read model", () => {
  it("keeps overlapping project and thread ids scoped to their environment", () => {
    const project = makeWorkspaceProjectFixture("project-1");
    const thread = makeWorkspaceThreadFixture("thread-1", project.id);
    const local = makeWorkspaceEnvironmentFixture({
      environmentId: "local",
      projects: [project],
      threads: [thread],
    });
    const remote = makeWorkspaceEnvironmentFixture({
      environmentId: "remote",
      projects: [project],
      threads: [thread],
    });

    const model = buildWorkspaceReadModel({
      environments: [local, remote],
      selection: {
        environmentId: EnvironmentId.make("remote"),
        projectId: null,
        threadId: ThreadId.make("thread-1"),
      },
    });

    expect(model.projects).toHaveLength(2);
    expect(model.threads).toHaveLength(2);
    expect(
      selectWorkspaceThread(model, EnvironmentId.make("local"), thread.id)?.environmentId,
    ).toBe("local");
    expect(model.selection).toEqual({
      environmentId: "remote",
      projectId: "project-1",
      threadId: "thread-1",
    });
  });

  it("projects stable attention in actionable priority order", () => {
    const project = makeWorkspaceProjectFixture("project-1");
    const running = makeRunningWorkspaceThread("running", project.id);
    const approval = makeWorkspaceThreadFixture("approval", project.id, {
      hasPendingApprovals: true,
    });
    const failed = makeWorkspaceThreadFixture("failed", project.id, {
      latestTurn: {
        turnId: TurnId.make("failed-turn"),
        state: "error",
        requestedAt: "2026-07-20T11:00:00.000Z",
        startedAt: "2026-07-20T11:00:00.000Z",
        completedAt: "2026-07-20T11:01:00.000Z",
        assistantMessageId: null,
      },
    });
    const environment = makeWorkspaceEnvironmentFixture({
      projects: [project],
      threads: [running, failed, approval],
    });

    const first = buildWorkspaceReadModel({ environments: [environment] });
    const second = buildWorkspaceReadModel({ environments: [environment] });

    expect(first.attention.map((item) => item.kind)).toEqual(["approval", "failed", "running"]);
    expect(second.attention.map((item) => item.id)).toEqual(first.attention.map((item) => item.id));
    expect(first.projects[0]).toMatchObject({
      activeThreadCount: 1,
      waitingThreadCount: 1,
      failedThreadCount: 1,
    });
  });

  it("marks cached reconnecting data stale without discarding it", () => {
    const project = makeWorkspaceProjectFixture("project-1");
    const environment = makeWorkspaceEnvironmentFixture({
      phase: "reconnecting",
      projects: [project],
    });
    const model = buildWorkspaceReadModel({ environments: [environment] });

    expect(model.isStale).toBe(true);
    expect(model.projects[0]?.connection.phase).toBe("reconnecting");
  });
});

describe("workspace controller", () => {
  it("preserves a snapshot across reconnect transitions and clears removed selections", () => {
    const project = makeWorkspaceProjectFixture("project-1");
    const environment = makeWorkspaceEnvironmentFixture({ projects: [project] });
    let state = createWorkspaceControllerState([environment]);
    state = reduceWorkspaceController(state, {
      _tag: "ProjectSelected",
      environmentId: environment.connection.environmentId,
      projectId: project.id,
    });
    state = reduceWorkspaceController(state, {
      _tag: "ConnectionUpdated",
      connection: { ...environment.connection, phase: "offline", error: "Network unavailable" },
    });

    expect(state.model.projects).toHaveLength(1);
    expect(state.model.isStale).toBe(true);
    expect(state.selection.projectId).toBe(project.id);

    state = reduceWorkspaceController(state, {
      _tag: "EnvironmentRemoved",
      environmentId: environment.connection.environmentId,
    });
    expect(state.model.projects).toEqual([]);
    expect(state.selection).toEqual({ environmentId: null, projectId: null, threadId: null });
  });
});

describe("workspace commands", () => {
  it("creates platform-independent project and thread intents", () => {
    const environmentId = EnvironmentId.make("environment-1");
    expect(
      WorkspaceCommands.renameProject(environmentId, ProjectId.make("project-1"), "Relay"),
    ).toEqual({
      _tag: "RenameProject",
      environmentId: "environment-1",
      projectId: "project-1",
      title: "Relay",
    });
    expect(WorkspaceCommands.restoreThread(environmentId, ThreadId.make("thread-1"))).toEqual({
      _tag: "RestoreThread",
      environmentId: "environment-1",
      threadId: "thread-1",
    });
  });
});
