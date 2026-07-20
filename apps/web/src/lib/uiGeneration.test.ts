import { describe, expect, it } from "vite-plus/test";

import { resolveUiGeneration, shouldRestoreWorkspaceInspectorFocus } from "./uiGeneration";

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

describe("shouldRestoreWorkspaceInspectorFocus", () => {
  it("preserves legacy inspector focus behavior", () => {
    expect(shouldRestoreWorkspaceInspectorFocus("legacy")).toBe(false);
  });

  it("restores focus for the next-generation workspace inspector", () => {
    expect(shouldRestoreWorkspaceInspectorFocus("next")).toBe(true);
  });
});
