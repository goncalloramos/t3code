import { describe, expect, it } from "vite-plus/test";

import { resolveUiGeneration, supportsProjectOverviewNavigation } from "./uiGeneration";

describe("resolveUiGeneration", () => {
  it("enables the rebuilt shell only for the explicit next value", () => {
    expect(resolveUiGeneration("next")).toBe("next");
  });

  it.each([undefined, null, "", "legacy", "experimental"])(
    "falls back to legacy for %s",
    (value) => {
      expect(resolveUiGeneration(value)).toBe("legacy");
    },
  );
});

describe("supportsProjectOverviewNavigation", () => {
  it("keeps legacy project headers as disclosure controls", () => {
    expect(supportsProjectOverviewNavigation("legacy")).toBe(false);
  });

  it("opens projects from next-generation compact and split shells", () => {
    expect(supportsProjectOverviewNavigation("next")).toBe(true);
  });
});
