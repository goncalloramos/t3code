import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { compareSemverVersions } from "@t3tools/shared/semver";

export const CUSTOM_UPSTREAM_REPOSITORY = "pingdotgg/t3code";
export const CUSTOM_UPDATE_PLAN_MARKER = "<!-- t3-custom-upstream-update -->";
const CUSTOM_UPDATE_DISMISSAL_PREFIX = "t3code-custom:upstream-update-dismissed:";
type SessionStorageLike = Pick<Storage, "getItem" | "setItem">;

export interface CustomUpstreamRelease {
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

export function parseCustomUpstreamRelease(value: unknown): CustomUpstreamRelease | null {
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

export function resolveNewCustomUpstreamRelease(
  currentVersion: string,
  value: unknown,
): CustomUpstreamRelease | null {
  const release = parseCustomUpstreamRelease(value);
  if (!release) return null;
  return compareSemverVersions(release.version, currentVersion) > 0 ? release : null;
}

export function customUpstreamDismissalKey(version: string): string {
  return `${CUSTOM_UPDATE_DISMISSAL_PREFIX}${version}`;
}

export function isCustomUpstreamReleaseDismissed(
  storage: SessionStorageLike,
  version: string,
): boolean {
  return storage.getItem(customUpstreamDismissalKey(version)) === "1";
}

export function dismissCustomUpstreamRelease(storage: SessionStorageLike, version: string): void {
  storage.setItem(customUpstreamDismissalKey(version), "1");
}

export function resolvePlanImplementationLabel(planMarkdown: string | null | undefined): string {
  return planMarkdown?.includes(CUSTOM_UPDATE_PLAN_MARKER) ? "Update" : "Implement";
}

export function isCustomT3RepositoryProject(project: EnvironmentProject): boolean {
  const identity = project.repositoryIdentity;
  const owner = identity?.owner?.toLowerCase();
  const name = identity?.name?.toLowerCase();
  const remoteUrl = identity?.locator.remoteUrl.toLowerCase() ?? "";
  const workspaceRoot = project.workspaceRoot.toLowerCase();

  return (
    (name === "t3code" && (owner === "goncalloramos" || owner === "pingdotgg")) ||
    remoteUrl.includes("github.com/goncalloramos/t3code") ||
    remoteUrl.includes("github.com/pingdotgg/t3code") ||
    workspaceRoot.endsWith("/t3 code custom")
  );
}

export function findCustomT3RepositoryProject(
  projects: ReadonlyArray<EnvironmentProject>,
): EnvironmentProject | null {
  return projects.find(isCustomT3RepositoryProject) ?? null;
}

export function buildCustomUpstreamAnalysisPrompt(input: {
  readonly currentVersion: string;
  readonly release: CustomUpstreamRelease;
}): string {
  return `Analyse the official T3 Code ${input.release.tagName} update against this custom fork.

Release: ${input.release.name}
Release URL: ${input.release.url}
Installed custom build version: ${input.currentVersion}

Read AGENTS.md completely, especially “Custom Fork Maintenance”, before doing anything. Fetch origin and upstream, calculate the real merge base, and compare the official update with every custom change. Detect patch-equivalent and semantic overlap even when upstream implemented the same behavior in different files or APIs.

This is analysis only. Do not merge, rebase, commit, push, edit tracked files, or build an installer in this thread. Report:

1. What changed upstream, including user-visible changes.
2. Which upstream changes overlap or replace our Codex quota UI, custom identity, icon/branding, updater isolation, signing, and maintenance documentation.
3. Likely conflicts and the exact resolution strategy.
4. What custom behavior must remain after the update.
5. Verification and macOS DMG build steps.

Finish with a proposed implementation plan. The plan must begin with this marker on its own line:
${CUSTOM_UPDATE_PLAN_MARKER}

The implementation plan must use a maintenance/upstream-YYYYMMDD branch, preserve the official-updater safety boundary, run the required tests, build and verify an installable DMG, and stop before pushing main unless the user explicitly authorizes that push.`;
}
