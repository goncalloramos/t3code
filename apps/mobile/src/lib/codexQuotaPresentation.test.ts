import { ProviderDriverKind, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { mobileCodexQuotaLabel } from "./codexQuotaPresentation";

function provider(input: Partial<ServerProvider> = {}): ServerProvider {
  return {
    instanceId: "codex",
    driver: "codex",
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-07-20T08:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    rateLimits: {
      status: "ready",
      buckets: [
        {
          id: "codex",
          name: null,
          windows: [
            { id: "primary", usedPercent: 27, windowDurationMins: 300, resetsAt: 1_900_000_000 },
            {
              id: "secondary",
              usedPercent: 59,
              windowDurationMins: 10_080,
              resetsAt: 1_900_000_000,
            },
          ],
        },
      ],
      updatedAt: "2026-07-20T08:00:00.000Z",
      message: null,
    },
    ...input,
  } as ServerProvider;
}

describe("mobileCodexQuotaLabel", () => {
  it("shows the remaining 5-hour and weekly allowance", () => {
    expect(mobileCodexQuotaLabel(provider(), 1_800_000_000_000)).toBe(
      "5h 73% left · Week 41% left",
    );
  });

  it("does not show quota for another provider", () => {
    expect(
      mobileCodexQuotaLabel(provider({ driver: ProviderDriverKind.make("claudeAgent") })),
    ).toBeNull();
  });

  it("surfaces authentication and expired states", () => {
    expect(mobileCodexQuotaLabel(provider({ auth: { status: "unauthenticated" } }))).toBe(
      "Codex sign-in required",
    );
    expect(mobileCodexQuotaLabel(provider(), 2_000_000_000_000)).toBe("Codex quota data expired");
  });
});
