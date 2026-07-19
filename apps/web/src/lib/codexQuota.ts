import type {
  ServerProviderRateLimitBucket,
  ServerProviderRateLimitWindow,
  ServerProviderRateLimits,
} from "@t3tools/contracts";

export function remainingCodexPercentage(usedPercent: number): number {
  if (!Number.isFinite(usedPercent)) return 100;
  return Math.max(0, Math.min(100, 100 - usedPercent));
}

export function codexQuotaWindowLabel(windowDurationMins: number | null): string {
  if (windowDurationMins === null || !Number.isFinite(windowDurationMins)) return "Usage window";
  const minutes = Math.max(0, Math.round(windowDurationMins));
  if (minutes === 10_080) return "Week";
  if (minutes > 0 && minutes % 10_080 === 0) return `${minutes / 10_080} weeks`;
  if (minutes === 1_440) return "Day";
  if (minutes > 0 && minutes % 1_440 === 0) return `${minutes / 1_440}d`;
  if (minutes > 0 && minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

export function sortCodexQuotaWindows(
  windows: ReadonlyArray<ServerProviderRateLimitWindow>,
): ReadonlyArray<ServerProviderRateLimitWindow> {
  return [...windows].sort(
    (left, right) =>
      (left.windowDurationMins ?? Number.POSITIVE_INFINITY) -
      (right.windowDurationMins ?? Number.POSITIVE_INFINITY),
  );
}

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

export function primaryCodexQuotaBucket(
  buckets: ReadonlyArray<ServerProviderRateLimitBucket>,
): ServerProviderRateLimitBucket | null {
  return buckets.find((bucket) => bucket.id.toLowerCase() === "codex") ?? buckets[0] ?? null;
}

export function codexQuotaSummary(rateLimits: ServerProviderRateLimits): string | null {
  if (rateLimits.status !== "ready") return null;
  const bucket = primaryCodexQuotaBucket(rateLimits.buckets);
  if (!bucket) return null;
  const parts = sortCodexQuotaWindows(bucket.windows)
    .slice(0, 2)
    .map(
      (window) =>
        `${codexQuotaWindowLabel(window.windowDurationMins)} ${Math.round(
          remainingCodexPercentage(window.usedPercent),
        )}% left`,
    );
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function isCodexQuotaExpired(
  rateLimits: ServerProviderRateLimits,
  nowMs = Date.now(),
): boolean {
  const windows = rateLimits.buckets.flatMap((bucket) => bucket.windows);
  return (
    rateLimits.status === "ready" &&
    windows.length > 0 &&
    windows.every((window) => window.resetsAt !== null && window.resetsAt * 1000 <= nowMs)
  );
}
