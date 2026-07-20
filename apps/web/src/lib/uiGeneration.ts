export type UiGeneration = "legacy" | "next";

export function resolveUiGeneration(value: unknown): UiGeneration {
  return value === "next" ? "next" : "legacy";
}

export const currentUiGeneration = resolveUiGeneration(import.meta.env.VITE_T3CODE_UI_GENERATION);

export function shouldRestoreWorkspaceInspectorFocus(generation: UiGeneration): boolean {
  return generation === "next";
}
