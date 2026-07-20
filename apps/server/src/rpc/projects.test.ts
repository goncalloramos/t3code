import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import * as WorkspaceEntries from "../workspace/WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "../workspace/WorkspaceFileSystem.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as WorkspaceSearchIndex from "../workspace/WorkspaceSearchIndex.ts";
import type { RpcHandlerObservers } from "./handlers.ts";
import {
  makeProjectRpcHandlers,
  PROJECT_RPC_METHODS,
  projectEntriesFailureContext,
  projectFileFailureContext,
} from "./projects.ts";

const observeEffect: RpcHandlerObservers["observeEffect"] = (_method, effect) => effect;

function makeServices() {
  const workspaceEntries = {
    browse: () => Effect.never,
    list: () => Effect.never,
    search: () => Effect.never,
    refresh: () => Effect.never,
  } satisfies WorkspaceEntries.WorkspaceEntries["Service"];
  const workspaceFileSystem = {
    readFile: () => Effect.never,
    writeFile: () => Effect.never,
  } satisfies WorkspaceFileSystem.WorkspaceFileSystem["Service"];

  return { workspaceEntries, workspaceFileSystem };
}

describe("project RPC handlers", () => {
  it("registers the existing project method identifiers without additions or omissions", () => {
    const handlers = makeProjectRpcHandlers(makeServices(), { observeEffect });

    assert.deepStrictEqual(Object.keys(handlers), [...PROJECT_RPC_METHODS]);
  });

  it("preserves workspace entry failure compatibility fields", () => {
    assert.deepStrictEqual(
      projectEntriesFailureContext(
        new WorkspacePaths.WorkspaceRootNotExistsError({
          workspaceRoot: "missing",
          normalizedWorkspaceRoot: "/repo/missing",
        }),
      ),
      { failure: "workspace_root_not_found", normalizedCwd: "/repo/missing" },
    );
    assert.deepStrictEqual(
      projectEntriesFailureContext(
        new WorkspaceSearchIndex.WorkspaceSearchIndexScanTimedOut({
          cwd: "/repo",
          timeout: "15 seconds",
        }),
      ),
      {
        failure: "search_index_scan_timed_out",
        normalizedCwd: "/repo",
        timeout: "15 seconds",
      },
    );
  });

  it("preserves project file safety failure compatibility fields", () => {
    assert.deepStrictEqual(
      projectFileFailureContext(
        new WorkspacePaths.WorkspacePathOutsideRootError({
          workspaceRoot: "/repo",
          relativePath: "../secret",
        }),
      ),
      { failure: "workspace_path_outside_root" },
    );
    assert.deepStrictEqual(
      projectFileFailureContext(
        new WorkspaceFileSystem.WorkspaceFilePathEscapeError({
          workspaceRoot: "/repo",
          relativePath: "link",
          resolvedWorkspaceRoot: "/repo",
          resolvedPath: "/secret",
        }),
      ),
      {
        failure: "resolved_path_outside_root",
        resolvedPath: "/secret",
        resolvedWorkspaceRoot: "/repo",
      },
    );
  });
});
