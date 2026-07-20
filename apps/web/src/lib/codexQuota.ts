export {
  codexQuotaSummary,
  codexQuotaWindowLabel,
  isCodexQuotaExpired,
  primaryCodexQuotaBucket,
  remainingCodexPercentage,
  sortCodexQuotaWindows,
} from "@t3tools/shared/codexRateLimits";

export function formatCodexQuotaReset(
  resetsAt: number | null,
  options?: { readonly locale?: string; readonly timeZone?: string },
): string {
  if (resetsAt === null || !Number.isFinite(resetsAt)) return "Reset time unavailable";
  return new Intl.DateTimeFormat(options?.locale, {
    dateStyle: "medium",
    timeStyle: "short",
    ...(options?.timeZone ? { timeZone: options.timeZone } : {}),
  }).format(new Date(resetsAt * 1000));
}
