import type { WorkspaceConnectionSummary } from "@t3tools/client-runtime/workspace";
import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { isWorkspaceProjectRouteResolved } from "./workspaceProjectRoute";

function connection(phase: WorkspaceConnectionSummary["phase"]): WorkspaceConnectionSummary {
  return {
    environmentId: EnvironmentId.make("environment-1"),
    label: "Environment",
    phase,
    hasSnapshot: phase === "live" || phase === "stale",
    error: null,
    snapshotUpdatedAt: null,
    retryAt: null,
  };
}

describe("workspace project route resolution", () => {
  it.each(["available", "connecting", "reconnecting"] as const)(
    "waits while the workspace connection is %s",
    (phase) => {
      expect(isWorkspaceProjectRouteResolved(connection(phase))).toBe(false);
    },
  );

  it.each(["live", "stale", "offline", "authentication-error", "unavailable"] as const)(
    "resolves project presence when the workspace connection is %s",
    (phase) => {
      expect(isWorkspaceProjectRouteResolved(connection(phase))).toBe(true);
    },
  );

  it("waits until the requested environment appears in the workspace model", () => {
    expect(isWorkspaceProjectRouteResolved(null)).toBe(false);
  });
});
