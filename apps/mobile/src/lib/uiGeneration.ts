export type UiGeneration = "legacy" | "next";

export function resolveUiGeneration(value: unknown): UiGeneration {
  return value === "next" ? "next" : "legacy";
}
