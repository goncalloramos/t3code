import { describe, expect, it } from "vite-plus/test";

import { ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";

import { buildProjectThreadStartTurnInput } from "./projectThreadStartTurn";

describe("buildProjectThreadStartTurnInput", () => {
  it("uses an explicit title and source plan for implementation threads", () => {
    const input = buildProjectThreadStartTurnInput({
      projectId: ProjectId.make("project-1"),
      projectCwd: "/repo",
      threadId: "thread-new",
      commandId: "command-1",
      messageId: "message-1",
      createdAt: "2026-07-22T10:00:00.000Z",
      text: "PLEASE IMPLEMENT THIS PLAN:\n# Mobile parity",
      attachments: [],
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.4",
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      workspaceMode: "local",
      branch: "feature/mobile",
      worktreePath: "/repo-worktree",
      startFromOrigin: false,
      worktreeBranchName: "unused",
      title: "Implement Mobile parity",
      sourceProposedPlan: {
        threadId: ThreadId.make("thread-source"),
        planId: "plan-1",
      },
    });

    expect(input).toMatchObject({
      titleSeed: "Implement Mobile parity",
      interactionMode: "default",
      sourceProposedPlan: { threadId: "thread-source", planId: "plan-1" },
      bootstrap: {
        createThread: {
          title: "Implement Mobile parity",
          branch: "feature/mobile",
          worktreePath: "/repo-worktree",
        },
      },
    });
  });
});
