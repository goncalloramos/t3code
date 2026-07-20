export type UiGeneration = "legacy" | "next";

export function resolveUiGeneration(value: unknown): UiGeneration {
  return value === "next" ? "next" : "legacy";
}

export function supportsProjectOverviewNavigation(generation: UiGeneration): boolean {
  return generation === "next";
}
