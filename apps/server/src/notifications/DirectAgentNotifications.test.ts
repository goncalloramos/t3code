import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { RelayAgentActivityState } from "@t3tools/contracts/relay";

import { makeDirectAgentNotificationPayload } from "./DirectAgentNotifications.ts";

const state = (phase: RelayAgentActivityState["phase"]): RelayAgentActivityState => ({
  environmentId: EnvironmentId.make("environment-test"),
  threadId: ThreadId.make("thread-test"),
  projectTitle: "T3 Code",
  threadTitle: "Implement direct notifications",
  phase,
  headline: "Agent update",
  detail: phase === "completed" ? "Review the completed task." : undefined,
  modelTitle: "Codex",
  updatedAt: "2026-07-22T07:30:00.000Z",
  deepLink: "/threads/environment-test/thread-test",
});

describe("makeDirectAgentNotificationPayload", () => {
  it.each([
    ["waiting_for_approval", "T3 Code · Approval required"],
    ["waiting_for_input", "T3 Code · Waiting for your response"],
    ["completed", "T3 Code · Finished"],
    ["failed", "T3 Code · Failed"],
  ] as const)("identifies the thread for %s notifications", (phase, body) => {
    expect(makeDirectAgentNotificationPayload(state(phase))).toEqual({
      title: "Implement direct notifications",
      body,
      environmentId: EnvironmentId.make("environment-test"),
      threadId: ThreadId.make("thread-test"),
      deepLink: "/threads/environment-test/thread-test",
      phase,
      updatedAt: "2026-07-22T07:30:00.000Z",
    });
  });

  it("does not create standard notifications for running states", () => {
    expect(makeDirectAgentNotificationPayload(state("running"))).toBeNull();
  });
});
