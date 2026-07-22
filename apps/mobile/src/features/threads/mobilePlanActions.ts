import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";

export function resolveMobilePlanActionsState<Plan>(input: {
  readonly plan: Plan | null;
  readonly hasPendingApproval: boolean;
  readonly hasPendingUserInput: boolean;
  readonly draftText: string;
  readonly attachmentCount: number;
  readonly connectionState: EnvironmentConnectionPhase;
  readonly threadBusy: boolean;
  readonly queueCount: number;
  readonly implementing: boolean;
}): { readonly plan: Plan | null; readonly disabled: boolean } {
  const plan =
    input.plan &&
    !input.hasPendingApproval &&
    !input.hasPendingUserInput &&
    input.draftText.trim().length === 0 &&
    input.attachmentCount === 0
      ? input.plan
      : null;

  return {
    plan,
    disabled:
      input.implementing ||
      input.connectionState !== "connected" ||
      input.threadBusy ||
      input.queueCount > 0,
  };
}
