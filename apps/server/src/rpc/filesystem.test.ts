import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as WorkspaceEntries from "../workspace/WorkspaceEntries.ts";
import type { RpcHandlerObservers } from "./handlers.ts";
import {
  FILESYSTEM_RPC_METHODS,
  filesystemBrowseFailureContext,
  makeFilesystemRpcHandlers,
} from "./filesystem.ts";

const observeEffect: RpcHandlerObservers["observeEffect"] = (_method, effect) => effect;

describe("filesystem RPC handlers", () => {
  it("registers the existing filesystem method identifiers without additions or omissions", () => {
    const handlers = makeFilesystemRpcHandlers(
      {
        externalLauncher: { launchEditor: () => Effect.never },
        projectionSnapshotQuery: {
          getThreadShellById: () => Effect.succeed(Option.none()),
          getProjectShellById: () => Effect.succeed(Option.none()),
        },
        workspaceEntries: { browse: () => Effect.never },
      },
      { observeEffect },
    );

    assert.deepStrictEqual(Object.keys(handlers), [...FILESYSTEM_RPC_METHODS]);
  });

  it("preserves browse failure compatibility fields", () => {
    assert.deepStrictEqual(
      filesystemBrowseFailureContext(
        new WorkspaceEntries.WorkspaceEntriesWindowsPathUnsupportedError({
          cwd: "/repo",
          partialPath: "C:\\repo",
          platform: "darwin",
        }),
      ),
      { failure: "windows_path_unsupported", platform: "darwin" },
    );
    assert.deepStrictEqual(
      filesystemBrowseFailureContext(
        new WorkspaceEntries.WorkspaceEntriesReadDirectoryError({
          cwd: "/repo",
          partialPath: "src",
          parentPath: "/repo/src",
          cause: new Error("denied"),
        }),
      ),
      { failure: "read_directory_failed", parentPath: "/repo/src" },
    );
  });
});
