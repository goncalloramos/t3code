import type { AgentAwarenessPhase } from "@t3tools/shared/agentAwareness";

export type DesktopAgentNotificationTransition = "input" | "completion";

export function resolveDesktopAgentNotificationTransition(
  previous: AgentAwarenessPhase | undefined,
  current: AgentAwarenessPhase,
): DesktopAgentNotificationTransition | null {
  if (current === "waiting_for_input" && previous !== "waiting_for_input") {
    return "input";
  }
  if (current === "completed" && (previous === "starting" || previous === "running")) {
    return "completion";
  }
  return null;
}
