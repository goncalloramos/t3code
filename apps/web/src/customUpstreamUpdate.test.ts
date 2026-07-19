import { EnvironmentId, ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  CUSTOM_UPDATE_PLAN_MARKER,
  buildCustomUpstreamAnalysisPrompt,
  dismissCustomUpstreamRelease,
  findCustomT3RepositoryProject,
  isCustomUpstreamReleaseDismissed,
  parseCustomUpstreamRelease,
  resolvePlanImplementationLabel,
  resolveNewCustomUpstreamRelease,
} from "./customUpstreamUpdate";

const release = {
  tag_name: "v0.0.29",
  name: "T3 Code 0.0.29",
  html_url: "https://github.com/pingdotgg/t3code/releases/tag/v0.0.29",
  published_at: "2026-07-20T12:00:00Z",
  body: "Release notes",
  draft: false,
  prerelease: false,
};

const project = (remoteUrl: string) => ({
  id: ProjectId.make("project"),
  environmentId: EnvironmentId.make("primary"),
  title: "T3 Code Custom",
  workspaceRoot: "/Users/example/T3 Code Custom",
  repositoryIdentity: {
    canonicalKey: "github.com/goncalloramos/t3code",
    locator: { source: "git-remote" as const, remoteName: "origin", remoteUrl },
    owner: "goncalloramos",
    name: "t3code",
  },
  defaultModelSelection: {
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-5-codex",
  },
  scripts: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});

describe("custom upstream updates", () => {
  it("parses a stable GitHub release", () => {
    expect(parseCustomUpstreamRelease(release)).toMatchObject({
      version: "0.0.29",
      tagName: "v0.0.29",
      notes: "Release notes",
    });
  });

  it("rejects prereleases and missing fields", () => {
    expect(parseCustomUpstreamRelease({ ...release, prerelease: true })).toBeNull();
    expect(parseCustomUpstreamRelease({ tag_name: "v0.0.29" })).toBeNull();
  });

  it("only returns versions newer than the installed custom build", () => {
    expect(resolveNewCustomUpstreamRelease("0.0.28", release)?.version).toBe("0.0.29");
    expect(resolveNewCustomUpstreamRelease("0.0.29", release)).toBeNull();
    expect(resolveNewCustomUpstreamRelease("0.0.30", release)).toBeNull();
  });

  it("scopes dismissal to the browser session and release version", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };

    expect(isCustomUpstreamReleaseDismissed(storage, "0.0.29")).toBe(false);
    dismissCustomUpstreamRelease(storage, "0.0.29");
    expect(isCustomUpstreamReleaseDismissed(storage, "0.0.29")).toBe(true);
    expect(isCustomUpstreamReleaseDismissed(storage, "0.0.30")).toBe(false);
  });

  it("finds the custom fork project and ignores unrelated repositories", () => {
    const custom = project("git@github.com:goncalloramos/t3code.git");
    const unrelated = {
      ...custom,
      id: ProjectId.make("other"),
      workspaceRoot: "/tmp/other",
      repositoryIdentity: {
        ...custom.repositoryIdentity,
        canonicalKey: "github.com/example/other",
        owner: "example",
        name: "other",
        locator: {
          ...custom.repositoryIdentity.locator,
          remoteUrl: "https://github.com/example/other",
        },
      },
    };
    expect(findCustomT3RepositoryProject([unrelated, custom])).toBe(custom);
  });

  it("builds an analysis-only prompt that hands implementation to the plan action", () => {
    const parsed = parseCustomUpstreamRelease(release)!;
    const prompt = buildCustomUpstreamAnalysisPrompt({ currentVersion: "0.0.28", release: parsed });
    expect(prompt).toContain(CUSTOM_UPDATE_PLAN_MARKER);
    expect(prompt).toContain("Do not merge");
    expect(prompt).toContain("maintenance/upstream-YYYYMMDD");
    expect(prompt).toContain("build and verify an installable DMG");
  });

  it("labels only marked maintenance plans as Update", () => {
    expect(resolvePlanImplementationLabel(`${CUSTOM_UPDATE_PLAN_MARKER}\nUpdate safely`)).toBe(
      "Update",
    );
    expect(resolvePlanImplementationLabel("Implement another feature")).toBe("Implement");
    expect(resolvePlanImplementationLabel(null)).toBe("Implement");
  });
});
