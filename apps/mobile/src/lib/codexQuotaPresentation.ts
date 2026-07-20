import type { ServerProvider } from "@t3tools/contracts";
import { codexQuotaSummary, isCodexQuotaExpired } from "@t3tools/shared/codexRateLimits";

export function mobileCodexQuotaLabel(
  provider: ServerProvider | null,
  nowMs = Date.now(),
): string | null {
  if (!provider || provider.driver !== "codex") return null;
  if (provider.auth.status === "unauthenticated") return "Codex sign-in required";

  const rateLimits = provider.rateLimits;
  if (!rateLimits || rateLimits.status === "loading") return "Codex quota loading…";
  if (rateLimits.status === "authentication-error") return "Codex sign-in required";
  if (rateLimits.status === "unavailable") return "Codex quota unavailable";
  if (isCodexQuotaExpired(rateLimits, nowMs)) return "Codex quota data expired";
  return codexQuotaSummary(rateLimits) ?? "Codex quota unavailable";
}
