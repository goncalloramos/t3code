import { describe, expect, it } from "vite-plus/test";

import {
  PROJECT_COLORS,
  colorWithAlpha,
  projectColorHex,
  resolveProjectColor,
} from "./projectColors";

describe("projectColors", () => {
  it("derives a stable default from the project id", () => {
    const first = resolveProjectColor({ id: "project-one" });
    expect(resolveProjectColor({ id: "project-one" })).toBe(first);
    expect(PROJECT_COLORS).toContain(first);
  });

  it("prefers a synced project color", () => {
    expect(resolveProjectColor({ id: "project-one", color: "pink" })).toBe("pink");
  });

  it("provides legible theme variants and translucent surfaces", () => {
    expect(projectColorHex("blue", false)).not.toBe(projectColorHex("blue", true));
    expect(colorWithAlpha("#2563EB", 0.12)).toBe("rgba(37, 99, 235, 0.12)");
  });
});
