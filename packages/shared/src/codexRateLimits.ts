import type {
  CodexRateLimitSnapshot,
  CodexRateLimitsSnapshot,
  ServerProviderRateLimitBucket,
  ServerProviderRateLimitWindow,
  ServerProviderRateLimits,
} from "@t3tools/contracts";

const DEFAULT_BUCKET_ID = "codex";

function asNonNegativeInteger(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

function normalizeUsedPercent(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}

function normalizeWindow(
  id: "primary" | "secondary",
  window: NonNullable<CodexRateLimitSnapshot[typeof id]>,
  previous?: ServerProviderRateLimitWindow,
): ServerProviderRateLimitWindow {
  return {
    id,
    usedPercent: normalizeUsedPercent(window.usedPercent),
    windowDurationMins:
      asNonNegativeInteger(window.windowDurationMins) ?? previous?.windowDurationMins ?? null,
    resetsAt: asNonNegativeInteger(window.resetsAt) ?? previous?.resetsAt ?? null,
  };
}

function mergeBucket(
  snapshot: CodexRateLimitSnapshot,
  fallbackId: string,
  previous?: ServerProviderRateLimitBucket,
): ServerProviderRateLimitBucket {
  const bucketId = snapshot.limitId?.trim() || previous?.id || fallbackId;
  const previousWindows = new Map(previous?.windows.map((window) => [window.id, window]));
  const windows = new Map(previous?.windows.map((window) => [window.id, window]));

  if (snapshot.primary) {
    windows.set(
      "primary",
      normalizeWindow("primary", snapshot.primary, previousWindows.get("primary")),
    );
  }
  if (snapshot.secondary) {
    windows.set(
      "secondary",
      normalizeWindow("secondary", snapshot.secondary, previousWindows.get("secondary")),
    );
  }

  return {
    id: bucketId,
    name: snapshot.limitName?.trim() || previous?.name || null,
    windows: [...windows.values()],
  };
}

function readyState(
  buckets: ReadonlyArray<ServerProviderRateLimitBucket>,
  updatedAt: string,
): ServerProviderRateLimits {
  return {
    status: buckets.some((bucket) => bucket.windows.length > 0) ? "ready" : "unavailable",
    buckets,
    updatedAt,
    message: buckets.some((bucket) => bucket.windows.length > 0)
      ? null
      : "Codex did not return any quota windows.",
  };
}

export function loadingCodexRateLimits(): ServerProviderRateLimits {
  return { status: "loading", buckets: [], updatedAt: null, message: null };
}

export function unavailableCodexRateLimits(
  updatedAt: string,
  authenticationError: boolean,
): ServerProviderRateLimits {
  return {
    status: authenticationError ? "authentication-error" : "unavailable",
    buckets: [],
    updatedAt,
    message: authenticationError
      ? "Sign in to Codex to view subscription usage."
      : "Codex subscription usage is temporarily unavailable.",
  };
}

export function isCodexRateLimitAuthenticationError(error: unknown): boolean {
  const text =
    error instanceof Error
      ? `${error.name} ${error.message}`
      : typeof error === "object" && error !== null && "_tag" in error
        ? String(error._tag)
        : String(error);
  return /auth|unauthori[sz]ed|forbidden|login|401|403/i.test(text);
}

export function normalizeCodexRateLimits(
  snapshot: CodexRateLimitsSnapshot,
  updatedAt: string,
): ServerProviderRateLimits {
  const entries = Object.entries(snapshot.rateLimitsByLimitId ?? {});
  const buckets =
    entries.length > 0
      ? entries.map(([limitId, bucket]) => mergeBucket(bucket, limitId))
      : [
          mergeBucket(
            snapshot.rateLimits,
            snapshot.rateLimits.limitId?.trim() || DEFAULT_BUCKET_ID,
          ),
        ];
  return readyState(buckets, updatedAt);
}

export function mergeCodexRateLimitUpdate(
  previous: ServerProviderRateLimits,
  update: CodexRateLimitSnapshot,
  updatedAt: string,
): ServerProviderRateLimits {
  const previousById = new Map(previous.buckets.map((bucket) => [bucket.id, bucket]));
  const fallbackId =
    update.limitId?.trim() || (previous.buckets.length === 1 ? previous.buckets[0]?.id : undefined);
  const bucketId = fallbackId || DEFAULT_BUCKET_ID;
  const nextBucket = mergeBucket(update, bucketId, previousById.get(bucketId));
  previousById.set(nextBucket.id, nextBucket);
  return readyState([...previousById.values()], updatedAt);
}

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

export function isCodexQuotaExpired(rateLimits: ServerProviderRateLimits, nowMs: number): boolean {
  const windows = rateLimits.buckets.flatMap((bucket) => bucket.windows);
  return (
    rateLimits.status === "ready" &&
    windows.length > 0 &&
    windows.every((window) => window.resetsAt !== null && window.resetsAt * 1000 <= nowMs)
  );
}
