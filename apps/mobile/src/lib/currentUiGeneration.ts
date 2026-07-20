import Constants from "expo-constants";

import { resolveUiGeneration, type UiGeneration } from "./uiGeneration";

export function currentUiGeneration(): UiGeneration {
  return resolveUiGeneration(Constants.expoConfig?.extra?.uiGeneration);
}
