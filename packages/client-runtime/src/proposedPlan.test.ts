import { describe, expect, it } from "vite-plus/test";

import { ThreadId, TurnId, type OrchestrationProposedPlan } from "@t3tools/contracts";

import {
  buildPlanImplementationPrompt,
  buildPlanImplementationThreadTitle,
  findActionableProposedPlan,
  findLatestProposedPlan,
  sourceProposedPlanReference,
} from "./proposedPlan.js";

const plan = (input: Partial<OrchestrationProposedPlan> = {}): OrchestrationProposedPlan => ({
  id: "plan-1",
  turnId: TurnId.make("turn-1"),
  planMarkdown: "# Mobile parity\n\n- Ship it",
  implementedAt: null,
  implementationThreadId: null,
  createdAt: "2026-07-22T10:00:00.000Z",
  updatedAt: "2026-07-22T10:00:00.000Z",
  ...input,
});

describe("proposed plans", () => {
  it("builds implementation copy and source references", () => {
    expect(buildPlanImplementationPrompt(plan().planMarkdown)).toContain("PLEASE IMPLEMENT");
    expect(buildPlanImplementationThreadTitle(plan().planMarkdown)).toBe("Implement Mobile parity");
    expect(sourceProposedPlanReference(ThreadId.make("thread-1"), plan())).toEqual({
      threadId: "thread-1",
      planId: "plan-1",
    });
  });

  it("prefers the latest plan belonging to the latest turn", () => {
    const other = plan({
      id: "plan-2",
      turnId: TurnId.make("turn-2"),
      updatedAt: "2026-07-22T11:00:00.000Z",
    });
    const plans = [other, plan()];
    expect(findLatestProposedPlan(plans, TurnId.make("turn-1"))?.id).toBe("plan-1");
    expect(plans.map((candidate) => candidate.id)).toEqual(["plan-2", "plan-1"]);
  });

  it("returns only settled, unimplemented plans", () => {
    const latestTurn = {
      turnId: TurnId.make("turn-1"),
      state: "completed" as const,
      requestedAt: "2026-07-22T09:59:00.000Z",
      startedAt: "2026-07-22T10:00:00.000Z",
      completedAt: "2026-07-22T10:01:00.000Z",
      assistantMessageId: null,
    };
    expect(
      findActionableProposedPlan({ proposedPlans: [plan()], latestTurn, session: null })?.id,
    ).toBe("plan-1");
    expect(
      findActionableProposedPlan({
        proposedPlans: [plan({ implementedAt: "2026-07-22T10:02:00.000Z" })],
        latestTurn,
        session: null,
      }),
    ).toBeNull();
  });
});
