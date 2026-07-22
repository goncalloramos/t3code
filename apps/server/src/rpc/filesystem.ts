import {
  AssetWorkspaceContextNotFoundError,
  AssetWorkspaceContextResolutionError,
  type FilesystemBrowseFailure,
  FilesystemBrowseError,
  WS_METHODS,
  type OrchestrationThread,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { extractWorkLogImages } from "@t3tools/shared/chatImages";

import { issueAssetUrl } from "../assets/AssetAccess.ts";
import type * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import type * as ExternalLauncher from "../process/externalLauncher.ts";
import type * as WorkspaceEntries from "../workspace/WorkspaceEntries.ts";
import type { RpcHandlerObservers } from "./handlers.ts";

function assertNever(error: never): never {
  throw new Error(`Unhandled filesystem RPC compatibility error: ${String(error)}`);
}

export function threadAuthorizesToolImage(
  thread: Pick<OrchestrationThread, "activities">,
  imagePath: string,
): boolean {
  return thread.activities.some((activity) =>
    extractWorkLogImages(activity.payload).some((image) => image.source === imagePath),
  );
}

export function filesystemBrowseFailureContext(
  error: WorkspaceEntries.WorkspaceEntriesBrowseError,
): {
  readonly failure: FilesystemBrowseFailure;
  readonly parentPath?: string;
  readonly platform?: string;
} {
  switch (error._tag) {
    case "WorkspaceEntriesWindowsPathUnsupportedError":
      return { failure: "windows_path_unsupported", platform: error.platform };
    case "WorkspaceEntriesCurrentProjectRequiredError":
      return { failure: "current_project_required" };
    case "WorkspaceEntriesReadDirectoryError":
      return { failure: "read_directory_failed", parentPath: error.parentPath };
    default:
      return assertNever(error);
  }
}

export const FILESYSTEM_RPC_METHODS = [
  WS_METHODS.shellOpenInEditor,
  WS_METHODS.filesystemBrowse,
  WS_METHODS.assetsCreateUrl,
] as const;

export function makeFilesystemRpcHandlers(
  services: {
    readonly externalLauncher: Pick<ExternalLauncher.ExternalLauncher["Service"], "launchEditor">;
    readonly projectionSnapshotQuery: Pick<
      ProjectionSnapshotQuery.ProjectionSnapshotQueryShape,
      "getThreadShellById" | "getThreadDetailById" | "getProjectShellById"
    >;
    readonly workspaceEntries: Pick<WorkspaceEntries.WorkspaceEntries["Service"], "browse">;
  },
  { observeEffect }: Pick<RpcHandlerObservers, "observeEffect">,
) {
  const traceAttributes = { "rpc.aggregate": "workspace" } as const;
  const { externalLauncher, projectionSnapshotQuery, workspaceEntries } = services;

  return {
    [WS_METHODS.shellOpenInEditor]: (input: Parameters<typeof externalLauncher.launchEditor>[0]) =>
      observeEffect(
        WS_METHODS.shellOpenInEditor,
        externalLauncher.launchEditor(input),
        traceAttributes,
      ),
    [WS_METHODS.filesystemBrowse]: (input: Parameters<typeof workspaceEntries.browse>[0]) =>
      observeEffect(
        WS_METHODS.filesystemBrowse,
        workspaceEntries.browse(input).pipe(
          Effect.mapError(
            (cause) =>
              new FilesystemBrowseError({
                ...input,
                ...filesystemBrowseFailureContext(cause),
                cause,
              }),
          ),
        ),
        traceAttributes,
      ),
    [WS_METHODS.assetsCreateUrl]: (input: Parameters<typeof issueAssetUrl>[0]) =>
      observeEffect(
        WS_METHODS.assetsCreateUrl,
        Effect.gen(function* () {
          if (input.resource._tag === "tool-image") {
            const resource = input.resource;
            const thread = yield* projectionSnapshotQuery
              .getThreadDetailById(resource.threadId)
              .pipe(
                Effect.mapError(
                  (cause) => new AssetWorkspaceContextResolutionError({ resource, cause }),
                ),
              );
            if (Option.isNone(thread)) {
              return yield* new AssetWorkspaceContextNotFoundError({ resource });
            }
            const authorized = threadAuthorizesToolImage(thread.value, resource.path);
            return yield* issueAssetUrl({
              resource,
              ...(authorized ? { authorizedToolImagePath: resource.path } : {}),
            });
          }
          if (input.resource._tag !== "workspace-file") {
            return yield* issueAssetUrl({ resource: input.resource });
          }
          const thread = yield* projectionSnapshotQuery
            .getThreadShellById(input.resource.threadId)
            .pipe(
              Effect.mapError(
                (cause) =>
                  new AssetWorkspaceContextResolutionError({
                    resource: input.resource,
                    cause,
                  }),
              ),
            );
          if (Option.isNone(thread)) {
            return yield* new AssetWorkspaceContextNotFoundError({ resource: input.resource });
          }
          const project = yield* projectionSnapshotQuery
            .getProjectShellById(thread.value.projectId)
            .pipe(
              Effect.mapError(
                (cause) =>
                  new AssetWorkspaceContextResolutionError({
                    resource: input.resource,
                    cause,
                  }),
              ),
            );
          if (Option.isNone(project)) {
            return yield* new AssetWorkspaceContextNotFoundError({ resource: input.resource });
          }
          return yield* issueAssetUrl({
            resource: input.resource,
            workspaceRoot: thread.value.worktreePath ?? project.value.workspaceRoot,
          });
        }),
        traceAttributes,
      ),
  };
}
