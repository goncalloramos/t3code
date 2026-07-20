import { describe, expect, it } from "vite-plus/test";
import { PROJECT_COLORS, projectColorHex, resolveProjectColor } from "./projectColors.ts";

describe("project colors", () => {
  it("assigns a stable default color", () => {
    const first = resolveProjectColor({ id: "project-one" });
    expect(PROJECT_COLORS).toContain(first);
    expect(resolveProjectColor({ id: "project-one" })).toBe(first);
  });

  it("prefers the synced color", () => {
    expect(resolveProjectColor({ id: "project-one", color: "pink" })).toBe("pink");
  });

  it("provides theme-specific accessible tints", () => {
    expect(projectColorHex("blue", false)).toBe("#2563EB");
    expect(projectColorHex("blue", true)).toBe("#60A5FA");
  });
});
