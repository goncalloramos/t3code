import {
  type ProjectEntriesFailure,
  type ProjectFileFailure,
  type ProjectFileOperation,
  ProjectListEntriesError,
  ProjectReadFileError,
  ProjectSearchEntriesError,
  ProjectWriteFileError,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type * as WorkspaceEntries from "../workspace/WorkspaceEntries.ts";
import type * as WorkspaceFileSystem from "../workspace/WorkspaceFileSystem.ts";
import type * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import type { RpcHandlerObservers } from "./handlers.ts";

function assertNever(error: never): never {
  throw new Error(`Unhandled project RPC compatibility error: ${String(error)}`);
}

export function projectEntriesFailureContext(error: WorkspaceEntries.WorkspaceEntriesError): {
  readonly failure: ProjectEntriesFailure;
  readonly normalizedCwd?: string;
  readonly timeout?: string;
  readonly detail?: string;
} {
  switch (error._tag) {
    case "WorkspaceRootNotExistsError":
      return { failure: "workspace_root_not_found", normalizedCwd: error.normalizedWorkspaceRoot };
    case "WorkspaceRootCreateFailedError":
      return {
        failure: "workspace_root_create_failed",
        normalizedCwd: error.normalizedWorkspaceRoot,
      };
    case "WorkspaceRootStatFailedError":
      return {
        failure: "workspace_root_stat_failed",
        normalizedCwd: error.normalizedWorkspaceRoot,
        detail: error.phase,
      };
    case "WorkspaceRootNotDirectoryError":
      return {
        failure: "workspace_root_not_directory",
        normalizedCwd: error.normalizedWorkspaceRoot,
      };
    case "WorkspaceSearchIndexCreateFailed":
      return {
        failure: "search_index_create_failed",
        normalizedCwd: error.cwd,
        detail: error.reason,
      };
    case "WorkspaceSearchIndexScanTimedOut":
      return {
        failure: "search_index_scan_timed_out",
        normalizedCwd: error.cwd,
        timeout: error.timeout,
      };
    case "WorkspaceSearchIndexSearchFailed":
      return {
        failure: "search_index_search_failed",
        normalizedCwd: error.cwd,
        detail: error.reason,
      };
    default:
      return assertNever(error);
  }
}

export function projectFileFailureContext(
  error:
    | WorkspaceFileSystem.WorkspaceFileSystemError
    | WorkspacePaths.WorkspacePathOutsideRootError,
): {
  readonly failure: ProjectFileFailure;
  readonly resolvedPath?: string;
  readonly resolvedWorkspaceRoot?: string;
  readonly operation?: ProjectFileOperation;
  readonly operationPath?: string;
} {
  switch (error._tag) {
    case "WorkspacePathOutsideRootError":
      return { failure: "workspace_path_outside_root" };
    case "WorkspaceFileSystemOperationError":
      return {
        failure: "operation_failed",
        resolvedPath: error.resolvedPath,
        operation: error.operation,
        operationPath: error.operationPath,
      };
    case "WorkspaceFilePathEscapeError":
      return {
        failure: "resolved_path_outside_root",
        resolvedPath: error.resolvedPath,
        resolvedWorkspaceRoot: error.resolvedWorkspaceRoot,
      };
    case "WorkspacePathNotFileError":
      return { failure: "path_not_file", resolvedPath: error.resolvedPath };
    case "WorkspaceBinaryFileError":
      return { failure: "binary_file", resolvedPath: error.resolvedPath };
    default:
      return assertNever(error);
  }
}

export const PROJECT_RPC_METHODS = [
  WS_METHODS.projectsSearchEntries,
  WS_METHODS.projectsListEntries,
  WS_METHODS.projectsReadFile,
  WS_METHODS.projectsWriteFile,
] as const;

export function makeProjectRpcHandlers(
  services: {
    readonly workspaceEntries: WorkspaceEntries.WorkspaceEntries["Service"];
    readonly workspaceFileSystem: WorkspaceFileSystem.WorkspaceFileSystem["Service"];
  },
  { observeEffect }: Pick<RpcHandlerObservers, "observeEffect">,
) {
  const traceAttributes = { "rpc.aggregate": "workspace" } as const;
  const { workspaceEntries, workspaceFileSystem } = services;

  return {
    [WS_METHODS.projectsSearchEntries]: (input: Parameters<typeof workspaceEntries.search>[0]) =>
      observeEffect(
        WS_METHODS.projectsSearchEntries,
        workspaceEntries.search(input).pipe(
          Effect.mapError(
            (cause) =>
              new ProjectSearchEntriesError({
                cwd: input.cwd,
                queryLength: input.query.length,
                limit: input.limit,
                ...projectEntriesFailureContext(cause),
                cause,
              }),
          ),
        ),
        traceAttributes,
      ),
    [WS_METHODS.projectsListEntries]: (input: Parameters<typeof workspaceEntries.list>[0]) =>
      observeEffect(
        WS_METHODS.projectsListEntries,
        workspaceEntries.list(input).pipe(
          Effect.mapError(
            (cause) =>
              new ProjectListEntriesError({
                ...input,
                ...projectEntriesFailureContext(cause),
                cause,
              }),
          ),
        ),
        traceAttributes,
      ),
    [WS_METHODS.projectsReadFile]: (input: Parameters<typeof workspaceFileSystem.readFile>[0]) =>
      observeEffect(
        WS_METHODS.projectsReadFile,
        workspaceFileSystem.readFile(input).pipe(
          Effect.mapError(
            (cause) =>
              new ProjectReadFileError({
                ...input,
                ...projectFileFailureContext(cause),
                cause,
              }),
          ),
        ),
        traceAttributes,
      ),
    [WS_METHODS.projectsWriteFile]: (input: Parameters<typeof workspaceFileSystem.writeFile>[0]) =>
      observeEffect(
        WS_METHODS.projectsWriteFile,
        workspaceFileSystem.writeFile(input).pipe(
          Effect.mapError(
            (cause) =>
              new ProjectWriteFileError({
                cwd: input.cwd,
                relativePath: input.relativePath,
                ...projectFileFailureContext(cause),
                cause,
              }),
          ),
        ),
        traceAttributes,
      ),
  };
}
