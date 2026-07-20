import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { compareSemverVersions } from "@t3tools/shared/semver";

export const GONCALLORAMOS_UPSTREAM_REPOSITORY = "pingdotgg/t3code";
export const GONCALLORAMOS_UPDATE_PLAN_MARKER = "<!-- t3-goncalloramos-upstream-update -->";
const GONCALLORAMOS_UPDATE_DISMISSAL_PREFIX = "t3code-goncalloramos:upstream-update-dismissed:";
type SessionStorageLike = Pick<Storage, "getItem" | "setItem">;

export interface GoncalloramosUpstreamRelease {
  readonly version: string;
  readonly tagName: string;
  readonly name: string;
  readonly url: string;
  readonly publishedAt: string;
  readonly notes: string;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function parseGoncalloramosUpstreamRelease(
  value: unknown,
): GoncalloramosUpstreamRelease | null {
  if (typeof value !== "object" || value === null) return null;
  const release = value as Record<string, unknown>;
  if (release.draft === true || release.prerelease === true) return null;

  const tagName = readString(release.tag_name);
  const url = readString(release.html_url);
  const publishedAt = readString(release.published_at);
  if (!tagName || !url || !publishedAt) return null;

  const version = tagName.replace(/^v/i, "");
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) return null;

  return {
    version,
    tagName,
    name: readString(release.name) ?? tagName,
    url,
    publishedAt,
    notes: readString(release.body) ?? "",
  };
}

export function resolveNewGoncalloramosUpstreamRelease(
  currentVersion: string,
  value: unknown,
): GoncalloramosUpstreamRelease | null {
  const release = parseGoncalloramosUpstreamRelease(value);
  if (!release) return null;
  return compareSemverVersions(release.version, currentVersion) > 0 ? release : null;
}

export function goncalloramosUpstreamDismissalKey(version: string): string {
  return `${GONCALLORAMOS_UPDATE_DISMISSAL_PREFIX}${version}`;
}

export function isGoncalloramosUpstreamReleaseDismissed(
  storage: SessionStorageLike,
  version: string,
): boolean {
  return storage.getItem(goncalloramosUpstreamDismissalKey(version)) === "1";
}

export function dismissGoncalloramosUpstreamRelease(
  storage: SessionStorageLike,
  version: string,
): void {
  storage.setItem(goncalloramosUpstreamDismissalKey(version), "1");
}

export function resolvePlanImplementationLabel(planMarkdown: string | null | undefined): string {
  return planMarkdown?.includes(GONCALLORAMOS_UPDATE_PLAN_MARKER) ? "Update" : "Implement";
}

export function isGoncalloramosT3RepositoryProject(project: EnvironmentProject): boolean {
  const identity = project.repositoryIdentity;
  const owner = identity?.owner?.toLowerCase();
  const name = identity?.name?.toLowerCase();
  const remoteUrl = identity?.locator.remoteUrl.toLowerCase() ?? "";
  const workspaceRoot = project.workspaceRoot.toLowerCase();

  return (
    (name === "t3code" && (owner === "goncalloramos" || owner === "pingdotgg")) ||
    remoteUrl.includes("github.com/goncalloramos/t3code") ||
    remoteUrl.includes("github.com/pingdotgg/t3code") ||
    workspaceRoot.endsWith("/t3 code - goncalloramos") ||
    workspaceRoot.endsWith("/t3 code custom")
  );
}

export function findGoncalloramosT3RepositoryProject(
  projects: ReadonlyArray<EnvironmentProject>,
): EnvironmentProject | null {
  return projects.find(isGoncalloramosT3RepositoryProject) ?? null;
}

export function buildGoncalloramosUpstreamAnalysisPrompt(input: {
  readonly currentVersion: string;
  readonly release: GoncalloramosUpstreamRelease;
}): string {
  return `Analyse the official T3 Code ${input.release.tagName} update against the T3 Code - goncalloramos fork.

Release: ${input.release.name}
Release URL: ${input.release.url}
Installed goncalloramos build version: ${input.currentVersion}

Read AGENTS.md completely, especially “Custom Fork Maintenance”, before doing anything. Fetch origin and upstream, calculate the real merge base, and compare the official update with every custom change. Detect patch-equivalent and semantic overlap even when upstream implemented the same behavior in different files or APIs.

This is analysis only. Do not merge, rebase, commit, push, edit tracked files, or build an installer in this thread. Report:

1. What changed upstream, including user-visible changes.
2. Which upstream changes overlap or replace our Codex quota UI, custom identity, icon/branding, updater isolation, signing, and maintenance documentation.
3. Likely conflicts and the exact resolution strategy.
4. What custom behavior must remain after the update.
5. Verification and macOS DMG build steps.

Finish with a proposed implementation plan. The plan must begin with this marker on its own line:
${GONCALLORAMOS_UPDATE_PLAN_MARKER}

The implementation plan must use a maintenance/upstream-YYYYMMDD branch, preserve the official-updater safety boundary, run the required tests, build and verify an installable DMG, and stop before pushing main unless the user explicitly authorizes that push.`;
}
