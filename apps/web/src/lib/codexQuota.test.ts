import { describe, expect, it } from "vite-plus/test";
import type { ServerProviderRateLimits } from "@t3tools/contracts";

import {
  codexQuotaSummary,
  codexQuotaWindowLabel,
  formatCodexQuotaReset,
  isCodexQuotaExpired,
  remainingCodexPercentage,
  sortCodexQuotaWindows,
} from "./codexQuota";

const quota: ServerProviderRateLimits = {
  status: "ready",
  updatedAt: "2026-07-19T12:00:00.000Z",
  message: null,
  buckets: [
    {
      id: "codex",
      name: "Codex",
      windows: [
        { id: "secondary", usedPercent: 59, windowDurationMins: 10_080, resetsAt: 1_800_500_000 },
        { id: "primary", usedPercent: 27, windowDurationMins: 300, resetsAt: 1_800_000_000 },
      ],
    },
  ],
};

describe("Codex quota formatting", () => {
  it("classifies windows by duration instead of primary/secondary names", () => {
    expect(codexQuotaWindowLabel(300)).toBe("5h");
    expect(codexQuotaWindowLabel(10_080)).toBe("Week");
    expect(codexQuotaWindowLabel(2_880)).toBe("2d");
    expect(codexQuotaWindowLabel(null)).toBe("Usage window");
    expect(sortCodexQuotaWindows(quota.buckets[0]!.windows).map((window) => window.id)).toEqual([
      "primary",
      "secondary",
    ]);
  });

  it("computes clamped remaining percentages and a compact summary", () => {
    expect(remainingCodexPercentage(27)).toBe(73);
    expect(remainingCodexPercentage(140)).toBe(0);
    expect(codexQuotaSummary(quota)).toBe("5h 73% left · Week 41% left");
  });

  it("formats exact resets deterministically", () => {
    expect(formatCodexQuotaReset(1_800_000_000, { locale: "en-GB", timeZone: "UTC" })).toBe(
      "15 Jan 2027, 08:00",
    );
    expect(formatCodexQuotaReset(null)).toBe("Reset time unavailable");
  });

  it("detects expired data only when every available window has reset", () => {
    expect(isCodexQuotaExpired(quota, 1_800_600_000_000)).toBe(true);
    expect(isCodexQuotaExpired(quota, 1_799_000_000_000)).toBe(false);
    expect(
      isCodexQuotaExpired(
        {
          ...quota,
          buckets: [
            {
              ...quota.buckets[0]!,
              windows: [{ ...quota.buckets[0]!.windows[0]!, resetsAt: null }],
            },
          ],
        },
        1_900_000_000_000,
      ),
    ).toBe(false);
  });

  it("uses the Codex bucket for the header when multiple buckets exist", () => {
    const multi = {
      ...quota,
      buckets: [
        {
          id: "reviews",
          name: "Reviews",
          windows: [{ id: "primary", usedPercent: 5, windowDurationMins: 60, resetsAt: null }],
        },
        ...quota.buckets,
      ],
    } satisfies ServerProviderRateLimits;
    expect(codexQuotaSummary(multi)).toBe("5h 73% left · Week 41% left");
  });
});
