import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";

export type WorkspaceCommand =
  | {
      readonly _tag: "SelectProject";
      readonly environmentId: EnvironmentId;
      readonly projectId: ProjectId;
    }
  | {
      readonly _tag: "SelectThread";
      readonly environmentId: EnvironmentId;
      readonly threadId: ThreadId;
    }
  | {
      readonly _tag: "CreateProject";
      readonly environmentId: EnvironmentId;
      readonly projectId: ProjectId;
      readonly title: string;
      readonly workspaceRoot: string;
    }
  | {
      readonly _tag: "RenameProject";
      readonly environmentId: EnvironmentId;
      readonly projectId: ProjectId;
      readonly title: string;
    }
  | {
      readonly _tag: "DeleteProject";
      readonly environmentId: EnvironmentId;
      readonly projectId: ProjectId;
    }
  | {
      readonly _tag: "ArchiveThread" | "RestoreThread" | "DeleteThread";
      readonly environmentId: EnvironmentId;
      readonly threadId: ThreadId;
    }
  | {
      readonly _tag: "RenameThread";
      readonly environmentId: EnvironmentId;
      readonly threadId: ThreadId;
      readonly title: string;
    };

export const WorkspaceCommands = {
  selectProject: (environmentId: EnvironmentId, projectId: ProjectId): WorkspaceCommand => ({
    _tag: "SelectProject",
    environmentId,
    projectId,
  }),
  selectThread: (environmentId: EnvironmentId, threadId: ThreadId): WorkspaceCommand => ({
    _tag: "SelectThread",
    environmentId,
    threadId,
  }),
  createProject: (
    environmentId: EnvironmentId,
    projectId: ProjectId,
    title: string,
    workspaceRoot: string,
  ): WorkspaceCommand => ({
    _tag: "CreateProject",
    environmentId,
    projectId,
    title,
    workspaceRoot,
  }),
  renameProject: (
    environmentId: EnvironmentId,
    projectId: ProjectId,
    title: string,
  ): WorkspaceCommand => ({ _tag: "RenameProject", environmentId, projectId, title }),
  deleteProject: (environmentId: EnvironmentId, projectId: ProjectId): WorkspaceCommand => ({
    _tag: "DeleteProject",
    environmentId,
    projectId,
  }),
  archiveThread: (environmentId: EnvironmentId, threadId: ThreadId): WorkspaceCommand => ({
    _tag: "ArchiveThread",
    environmentId,
    threadId,
  }),
  restoreThread: (environmentId: EnvironmentId, threadId: ThreadId): WorkspaceCommand => ({
    _tag: "RestoreThread",
    environmentId,
    threadId,
  }),
  renameThread: (
    environmentId: EnvironmentId,
    threadId: ThreadId,
    title: string,
  ): WorkspaceCommand => ({ _tag: "RenameThread", environmentId, threadId, title }),
  deleteThread: (environmentId: EnvironmentId, threadId: ThreadId): WorkspaceCommand => ({
    _tag: "DeleteThread",
    environmentId,
    threadId,
  }),
} as const;
