import { describe, expect, it } from "vite-plus/test";

import { resolveDesktopAgentNotificationTransition } from "./DesktopAgentNotifications.logic";

describe("resolveDesktopAgentNotificationTransition", () => {
  it("notifies when an agent starts waiting for an answer", () => {
    expect(resolveDesktopAgentNotificationTransition("running", "waiting_for_input")).toBe("input");
  });

  it("notifies when active work completes", () => {
    expect(resolveDesktopAgentNotificationTransition("running", "completed")).toBe("completion");
    expect(resolveDesktopAgentNotificationTransition("starting", "completed")).toBe("completion");
  });

  it("does not notify for initial snapshots or repeat terminal projections", () => {
    expect(resolveDesktopAgentNotificationTransition(undefined, "completed")).toBeNull();
    expect(resolveDesktopAgentNotificationTransition("completed", "completed")).toBeNull();
  });

  it("does not mistake the brief post-answer ready state for a completed turn", () => {
    expect(resolveDesktopAgentNotificationTransition("waiting_for_input", "completed")).toBeNull();
  });
});
