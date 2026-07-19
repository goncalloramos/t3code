import { describe, expect, it } from "vite-plus/test";

import {
  loadingCodexRateLimits,
  mergeCodexRateLimitUpdate,
  normalizeCodexRateLimits,
} from "./codexRateLimits.ts";

const NOW = "2026-07-19T12:00:00.000Z";

describe("Codex rate-limit normalization", () => {
  it("normalizes every bucket and preserves missing window fields", () => {
    const result = normalizeCodexRateLimits(
      {
        rateLimits: { limitId: "codex" },
        rateLimitsByLimitId: {
          codex: {
            limitId: "codex",
            limitName: "Codex",
            primary: { usedPercent: 27, windowDurationMins: 300, resetsAt: 1_800_000_000 },
            secondary: { usedPercent: 59, windowDurationMins: 10_080 },
          },
          reviews: {
            limitId: "reviews",
            limitName: "Code reviews",
            primary: { usedPercent: 10, windowDurationMins: null, resetsAt: null },
          },
        },
      },
      NOW,
    );

    expect(result.status).toBe("ready");
    expect(result.buckets).toHaveLength(2);
    expect(result.buckets[1]).toMatchObject({
      id: "reviews",
      windows: [{ usedPercent: 10, windowDurationMins: null, resetsAt: null }],
    });
  });

  it("merges sparse updates without clearing prior duration or reset metadata", () => {
    const initial = normalizeCodexRateLimits(
      {
        rateLimits: {
          limitId: "codex",
          primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: 1_800_000_000 },
          secondary: { usedPercent: 40, windowDurationMins: 10_080, resetsAt: 1_800_500_000 },
        },
      },
      NOW,
    );

    const merged = mergeCodexRateLimitUpdate(
      initial,
      { limitId: "codex", primary: { usedPercent: 35 } },
      "2026-07-19T12:05:00.000Z",
    );

    expect(merged.buckets[0]?.windows).toEqual([
      { id: "primary", usedPercent: 35, windowDurationMins: 300, resetsAt: 1_800_000_000 },
      { id: "secondary", usedPercent: 40, windowDurationMins: 10_080, resetsAt: 1_800_500_000 },
    ]);
  });

  it("adds a new sparse bucket and handles a snapshot with no windows", () => {
    const missing = normalizeCodexRateLimits({ rateLimits: {} }, NOW);
    expect(missing.status).toBe("unavailable");

    const merged = mergeCodexRateLimitUpdate(
      loadingCodexRateLimits(),
      { limitId: "reviews", primary: { usedPercent: 120, windowDurationMins: 60 } },
      NOW,
    );
    expect(merged.buckets[0]).toMatchObject({
      id: "reviews",
      windows: [{ usedPercent: 100, windowDurationMins: 60, resetsAt: null }],
    });
  });
});
