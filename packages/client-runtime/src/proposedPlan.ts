import type {
  OrchestrationLatestTurn,
  OrchestrationProposedPlan,
  OrchestrationProposedPlanId,
  OrchestrationSession,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";

export interface SourceProposedPlanReference {
  readonly threadId: ThreadId;
  readonly planId: OrchestrationProposedPlanId;
}

export function proposedPlanTitle(planMarkdown: string): string | null {
  const heading = planMarkdown.match(/^\s{0,3}#{1,6}\s+(.+)$/m)?.[1]?.trim();
  return heading && heading.length > 0 ? heading : null;
}

export function buildPlanImplementationPrompt(planMarkdown: string): string {
  return `PLEASE IMPLEMENT THIS PLAN:\n${planMarkdown.trim()}`;
}

export function buildPlanImplementationThreadTitle(planMarkdown: string): string {
  const title = proposedPlanTitle(planMarkdown);
  return title ? `Implement ${title}` : "Implement plan";
}

export function sourceProposedPlanReference(
  threadId: ThreadId,
  plan: Pick<OrchestrationProposedPlan, "id">,
): SourceProposedPlanReference {
  return { threadId, planId: plan.id };
}

export function findLatestProposedPlan(
  proposedPlans: ReadonlyArray<OrchestrationProposedPlan>,
  latestTurnId: TurnId | string | null | undefined,
): OrchestrationProposedPlan | null {
  const latestPlan = (
    plans: ReadonlyArray<OrchestrationProposedPlan>,
  ): OrchestrationProposedPlan | null => {
    const sortedPlans = [...plans].sort(
      (left, right) =>
        left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id),
    );
    return sortedPlans[sortedPlans.length - 1] ?? null;
  };

  if (latestTurnId) {
    const matchingTurnPlan = latestPlan(
      proposedPlans.filter((plan) => plan.turnId === latestTurnId),
    );
    if (matchingTurnPlan) return matchingTurnPlan;
  }

  return latestPlan(proposedPlans);
}

export function hasActionableProposedPlan(
  proposedPlan: Pick<OrchestrationProposedPlan, "implementedAt"> | null,
): boolean {
  return proposedPlan !== null && proposedPlan.implementedAt === null;
}

type LatestTurnTiming = Pick<OrchestrationLatestTurn, "startedAt" | "completedAt">;
type SessionActivityState = Pick<OrchestrationSession, "status">;

export function isLatestTurnSettled(
  latestTurn: LatestTurnTiming | null,
  session: SessionActivityState | null,
): boolean {
  if (!latestTurn?.startedAt || !latestTurn.completedAt) return false;
  return session?.status !== "running" && session?.status !== "starting";
}

export function findActionableProposedPlan(input: {
  readonly proposedPlans: ReadonlyArray<OrchestrationProposedPlan>;
  readonly latestTurn: OrchestrationLatestTurn | null;
  readonly session: OrchestrationSession | null;
}): OrchestrationProposedPlan | null {
  if (!isLatestTurnSettled(input.latestTurn, input.session)) return null;
  const latestPlan = findLatestProposedPlan(input.proposedPlans, input.latestTurn?.turnId);
  return hasActionableProposedPlan(latestPlan) ? latestPlan : null;
}
