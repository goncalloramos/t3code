import { describe, expect, it } from "vite-plus/test";

import { resolveMobilePlanActionsState } from "./mobilePlanActions";

const ready = {
  plan: { id: "plan-1" },
  hasPendingApproval: false,
  hasPendingUserInput: false,
  draftText: "",
  attachmentCount: 0,
  connectionState: "connected" as const,
  threadBusy: false,
  queueCount: 0,
  implementing: false,
};

describe("mobile plan actions", () => {
  it("shows an enabled ready plan", () => {
    expect(resolveMobilePlanActionsState(ready)).toEqual({ plan: ready.plan, disabled: false });
  });

  it("hides actions behind approvals, input, or refinement drafts", () => {
    expect(resolveMobilePlanActionsState({ ...ready, hasPendingApproval: true }).plan).toBeNull();
    expect(resolveMobilePlanActionsState({ ...ready, hasPendingUserInput: true }).plan).toBeNull();
    expect(resolveMobilePlanActionsState({ ...ready, draftText: "Refine it" }).plan).toBeNull();
    expect(resolveMobilePlanActionsState({ ...ready, attachmentCount: 1 }).plan).toBeNull();
  });

  it("disables actions while unavailable, busy, queued, or implementing", () => {
    expect(resolveMobilePlanActionsState({ ...ready, connectionState: "offline" }).disabled).toBe(
      true,
    );
    expect(resolveMobilePlanActionsState({ ...ready, threadBusy: true }).disabled).toBe(true);
    expect(resolveMobilePlanActionsState({ ...ready, queueCount: 1 }).disabled).toBe(true);
    expect(resolveMobilePlanActionsState({ ...ready, implementing: true }).disabled).toBe(true);
  });
});
