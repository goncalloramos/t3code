import type { EnvironmentId } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createProjectEnvironmentAtoms,
  type CreateProjectInput,
  type DeleteProjectInput,
  type UpdateProjectInput,
} from "../state/projectCommands.ts";
import {
  createThreadEnvironmentAtoms,
  type ArchiveThreadInput,
  type DeleteThreadInput,
  type UnarchiveThreadInput,
  type UpdateThreadMetadataInput,
} from "../state/threadCommands.ts";
import type { AtomCommandResult } from "../state/runtime.ts";
import type { WorkspaceCommand } from "./commands.ts";
import type { WorkspaceSelection } from "./model.ts";

interface WorkspaceEnvironmentCommand<Input> {
  readonly run: (
    registry: AtomRegistry.AtomRegistry,
    target: { readonly environmentId: EnvironmentId; readonly input: Input },
  ) => Promise<AtomCommandResult<unknown, unknown>>;
}

export interface WorkspaceCommandTargets {
  readonly selectionAtom: Atom.Writable<WorkspaceSelection>;
  readonly projects: {
    readonly create: WorkspaceEnvironmentCommand<CreateProjectInput>;
    readonly update: WorkspaceEnvironmentCommand<UpdateProjectInput>;
    readonly delete: WorkspaceEnvironmentCommand<DeleteProjectInput>;
  };
  readonly threads: {
    readonly archive: WorkspaceEnvironmentCommand<ArchiveThreadInput>;
    readonly unarchive: WorkspaceEnvironmentCommand<UnarchiveThreadInput>;
    readonly updateMetadata: WorkspaceEnvironmentCommand<UpdateThreadMetadataInput>;
    readonly delete: WorkspaceEnvironmentCommand<DeleteThreadInput>;
  };
}

function runEnvironmentCommand<Input>(
  registry: AtomRegistry.AtomRegistry,
  command: WorkspaceEnvironmentCommand<Input>,
  environmentId: EnvironmentId,
  input: Input,
): Promise<AtomCommandResult<unknown, unknown>> {
  return command.run(registry, { environmentId, input });
}

export function createWorkspaceCommandRouter(targets: WorkspaceCommandTargets) {
  return {
    label: "workspace:command",
    run(
      registry: AtomRegistry.AtomRegistry,
      command: WorkspaceCommand,
    ): Promise<AtomCommandResult<unknown, unknown>> {
      switch (command._tag) {
        case "SelectProject":
          registry.set(targets.selectionAtom, {
            environmentId: command.environmentId,
            projectId: command.projectId,
            threadId: null,
          });
          return Promise.resolve(AsyncResult.success(undefined));
        case "SelectThread":
          registry.set(targets.selectionAtom, {
            environmentId: command.environmentId,
            projectId: null,
            threadId: command.threadId,
          });
          return Promise.resolve(AsyncResult.success(undefined));
        case "CreateProject":
          return runEnvironmentCommand(registry, targets.projects.create, command.environmentId, {
            projectId: command.projectId,
            title: command.title,
            workspaceRoot: command.workspaceRoot,
            createWorkspaceRootIfMissing: true,
          });
        case "RenameProject":
          return runEnvironmentCommand(registry, targets.projects.update, command.environmentId, {
            projectId: command.projectId,
            title: command.title,
          });
        case "DeleteProject":
          return runEnvironmentCommand(registry, targets.projects.delete, command.environmentId, {
            projectId: command.projectId,
          });
        case "ArchiveThread":
          return runEnvironmentCommand(registry, targets.threads.archive, command.environmentId, {
            threadId: command.threadId,
          });
        case "RestoreThread":
          return runEnvironmentCommand(registry, targets.threads.unarchive, command.environmentId, {
            threadId: command.threadId,
          });
        case "RenameThread":
          return runEnvironmentCommand(
            registry,
            targets.threads.updateMetadata,
            command.environmentId,
            { threadId: command.threadId, title: command.title },
          );
        case "DeleteThread":
          return runEnvironmentCommand(registry, targets.threads.delete, command.environmentId, {
            threadId: command.threadId,
          });
      }
    },
  } as const;
}

export function createWorkspaceCommandScheduler<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | Crypto.Crypto | R, E>,
  selectionAtom: Atom.Writable<WorkspaceSelection>,
) {
  const projects = createProjectEnvironmentAtoms(runtime);
  const threads = createThreadEnvironmentAtoms(runtime);
  return createWorkspaceCommandRouter({ selectionAtom, projects, threads });
}
