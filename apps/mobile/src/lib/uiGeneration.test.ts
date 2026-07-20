import { describe, expect, it } from "vite-plus/test";

import { resolveUiGeneration } from "./uiGeneration";

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
