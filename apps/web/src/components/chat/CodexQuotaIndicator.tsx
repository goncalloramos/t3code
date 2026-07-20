import type { ServerProvider, ServerProviderRateLimits } from "@t3tools/contracts";
import { Gauge } from "lucide-react";

import {
  codexQuotaSummary,
  codexQuotaWindowLabel,
  formatCodexQuotaReset,
  isCodexQuotaExpired,
  remainingCodexPercentage,
  sortCodexQuotaWindows,
} from "~/lib/codexQuota";
import { cn } from "~/lib/utils";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";

function quotaPresentation(provider: ServerProvider): {
  readonly label: string;
  readonly state: "loading" | "ready" | "unavailable" | "authentication-error" | "expired";
  readonly rateLimits: ServerProviderRateLimits | null;
} {
  if (provider.auth.status === "unauthenticated") {
    return {
      label: "Codex sign-in required",
      state: "authentication-error",
      rateLimits: provider.rateLimits ?? null,
    };
  }
  const rateLimits = provider.rateLimits;
  if (!rateLimits || rateLimits.status === "loading") {
    return { label: "Codex quota loading…", state: "loading", rateLimits: rateLimits ?? null };
  }
  if (rateLimits.status === "authentication-error") {
    return { label: "Codex sign-in required", state: "authentication-error", rateLimits };
  }
  if (rateLimits.status === "unavailable") {
    return { label: "Codex quota unavailable", state: "unavailable", rateLimits };
  }
  if (isCodexQuotaExpired(rateLimits, Date.now())) {
    return { label: "Codex quota data expired", state: "expired", rateLimits };
  }
  return {
    label: codexQuotaSummary(rateLimits) ?? "Codex quota unavailable",
    state: "ready",
    rateLimits,
  };
}

export function CodexQuotaIndicator({ provider }: { readonly provider: ServerProvider | null }) {
  if (!provider || provider.driver !== "codex") return null;
  const presentation = quotaPresentation(provider);
  const showBuckets = presentation.rateLimits?.buckets.some((bucket) => bucket.windows.length > 0);

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={presentation.label}
            className={cn(
              "hidden h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-border/60 bg-muted/30 px-2 text-[11px] font-medium tabular-nums text-muted-foreground outline-none transition-colors @xl/header-actions:inline-flex",
              "hover:bg-accent hover:text-foreground data-[pressed]:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
              presentation.state === "authentication-error" && "text-warning",
            )}
          >
            <Gauge className="size-3.5" aria-hidden="true" />
            <span className="max-w-52 truncate">{presentation.label}</span>
          </button>
        }
      />
      <PopoverPopup side="bottom" align="end" className="w-80 max-w-[calc(100vw-1rem)] p-0">
        <div className="flex flex-col gap-3 p-3">
          <div>
            <div className="text-xs font-semibold text-foreground">Codex subscription usage</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {presentation.state === "ready"
                ? "Remaining quota across the available rolling windows."
                : presentation.label}
            </div>
          </div>

          {showBuckets
            ? presentation.rateLimits?.buckets.map((bucket) => (
                <section key={bucket.id} className="flex flex-col gap-2.5">
                  {presentation.rateLimits!.buckets.length > 1 ? (
                    <div className="border-t border-border/60 pt-2 text-[11px] font-semibold text-muted-foreground first:border-t-0 first:pt-0">
                      {bucket.name ?? bucket.id}
                    </div>
                  ) : null}
                  {sortCodexQuotaWindows(bucket.windows).map((window) => {
                    const remaining = remainingCodexPercentage(window.usedPercent);
                    return (
                      <div key={window.id} className="flex flex-col gap-1.5">
                        <div className="flex items-baseline justify-between gap-3 text-xs">
                          <span className="font-medium text-foreground">
                            {codexQuotaWindowLabel(window.windowDurationMins)}
                          </span>
                          <span className="tabular-nums text-muted-foreground">
                            {Math.round(remaining)}% left · {Math.round(window.usedPercent)}% used
                          </span>
                        </div>
                        <div
                          className="h-1.5 overflow-hidden rounded-full bg-muted"
                          role="progressbar"
                          aria-label={`${codexQuotaWindowLabel(window.windowDurationMins)} quota remaining`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={Math.round(remaining)}
                        >
                          <div
                            className={cn(
                              "h-full rounded-full transition-[width,background-color] duration-300 motion-reduce:transition-none",
                              remaining <= 10
                                ? "bg-destructive"
                                : remaining <= 25
                                  ? "bg-warning"
                                  : "bg-primary",
                            )}
                            style={{ width: `${remaining}%` }}
                          />
                        </div>
                        <div className="text-[11px] tabular-nums text-muted-foreground/75">
                          Resets {formatCodexQuotaReset(window.resetsAt)}
                        </div>
                      </div>
                    );
                  })}
                </section>
              ))
            : null}

          {presentation.state === "expired" ? (
            <div className="rounded-md bg-warning/10 px-2.5 py-2 text-[11px] text-warning">
              These quota windows have reset. T3 Code is waiting for fresh Codex usage data.
            </div>
          ) : null}
          {!showBuckets && presentation.rateLimits?.message ? (
            <div className="rounded-md bg-muted/60 px-2.5 py-2 text-[11px] text-muted-foreground">
              {presentation.rateLimits.message}
            </div>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
