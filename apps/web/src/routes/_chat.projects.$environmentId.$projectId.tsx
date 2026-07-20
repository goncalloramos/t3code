import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { WorkspaceCommands, workspaceAgentState } from "@t3tools/client-runtime/workspace";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import {
  AlertCircleIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  CircleDotIcon,
  Clock3Icon,
  FolderGit2Icon,
  PlusIcon,
  WifiOffIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "../components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../components/ui/empty";
import { SidebarInset } from "../components/ui/sidebar";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useAllEnvironmentShellsBootstrapped } from "../state/entities";
import {
  useWorkspaceConnection,
  useWorkspaceProject,
  useWorkspaceProjectThreads,
  workspaceCommands,
} from "../state/workspace";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { cn } from "../lib/utils";
import { currentUiGeneration } from "../lib/uiGeneration";
import { isWorkspaceProjectRouteResolved } from "../workspaceProjectRoute";

function statusPresentation(thread: Parameters<typeof workspaceAgentState>[0]) {
  const state = workspaceAgentState(thread);
  switch (state) {
    case "active":
      return { label: "Working", icon: CircleDotIcon, className: "text-sky-600 dark:text-sky-400" };
    case "waiting":
      return {
        label: "Needs attention",
        icon: Clock3Icon,
        className: "text-amber-700 dark:text-amber-400",
      };
    case "failed":
      return {
        label: "Failed",
        icon: AlertCircleIcon,
        className: "text-rose-600 dark:text-rose-400",
      };
    case "completed":
      return {
        label: "Completed",
        icon: CheckCircle2Icon,
        className: "text-emerald-700 dark:text-emerald-400",
      };
    case "idle":
      return { label: "Ready", icon: CircleDotIcon, className: "text-muted-foreground" };
  }
}

function ProjectOverviewRouteView() {
  const params = Route.useParams();
  const environmentId = params.environmentId as EnvironmentId;
  const projectId = params.projectId as ProjectId;
  const projectRef = scopeProjectRef(environmentId, projectId);
  const project = useWorkspaceProject(projectRef);
  const connection = useWorkspaceConnection(environmentId);
  const projectThreads = useWorkspaceProjectThreads(projectRef);
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const handleNewThread = useNewThreadHandler();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const workspaceResolved = isWorkspaceProjectRouteResolved(connection);

  useEffect(() => {
    void workspaceCommands.run(
      appAtomRegistry,
      WorkspaceCommands.selectProject(environmentId, projectId),
    );
  }, [environmentId, projectId]);

  useEffect(() => {
    if (bootstrapped && workspaceResolved && project === null) {
      void navigate({ to: "/", replace: true });
    }
  }, [bootstrapped, navigate, project, workspaceResolved]);

  if (!bootstrapped || !workspaceResolved || project === null) return null;

  const connectionPhase = connection?.phase ?? "available";
  const disconnected = connectionPhase !== "live";
  const startThread = async () => {
    if (creating) return;
    setCreating(true);
    try {
      await handleNewThread(projectRef);
    } finally {
      setCreating(false);
    }
  };

  return (
    <SidebarInset className="h-svh min-h-0 overflow-auto bg-background text-foreground md:h-dvh">
      <main className="mx-auto flex min-h-full w-full max-w-6xl flex-col px-4 py-5 sm:px-7 sm:py-8">
        {disconnected ? (
          <div className="mb-5 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/8 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            <WifiOffIcon className="size-4 shrink-0" />
            {connectionPhase === "reconnecting"
              ? `Reconnecting to ${connection?.label ?? "environment"}. Project history may be stale.`
              : `${connection?.label ?? "Environment"} is ${connectionPhase}. Cached project history remains available.`}
          </div>
        ) : null}

        <header className="flex flex-col gap-5 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
              <FolderGit2Icon className="size-4" />
              <span>{connection?.label ?? environmentId}</span>
              <span aria-hidden="true">·</span>
              <span className="truncate font-mono">{project.workspaceRoot}</span>
            </div>
            <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">
              {project.title}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {projectThreads.length} {projectThreads.length === 1 ? "thread" : "threads"} · project
              overview
            </p>
          </div>
          <Button disabled={creating || disconnected} onClick={() => void startThread()}>
            <PlusIcon className="size-4" />
            {creating ? "Opening…" : "New thread"}
          </Button>
        </header>

        {projectThreads.length === 0 ? (
          <Empty className="flex-1 py-16">
            <EmptyHeader>
              <EmptyTitle>No threads yet</EmptyTitle>
              <EmptyDescription>
                Start a thread in this project. Your draft will remain tied to this environment and
                workspace.
              </EmptyDescription>
              <Button
                className="mt-4"
                disabled={creating || disconnected}
                onClick={() => void startThread()}
              >
                <PlusIcon className="size-4" /> Start first thread
              </Button>
            </EmptyHeader>
          </Empty>
        ) : (
          <section aria-labelledby="threads-heading" className="py-7">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="threads-heading" className="text-sm font-semibold">
                Recent threads
              </h2>
              <span className="text-xs text-muted-foreground">Newest activity first</span>
            </div>
            <div className="grid gap-2">
              {projectThreads.map((thread) => {
                const status = statusPresentation(thread);
                const StatusIcon = status.icon;
                return (
                  <Link
                    key={thread.id}
                    to="/$environmentId/$threadId"
                    params={{ environmentId: thread.environmentId, threadId: thread.id }}
                    className="group grid min-h-16 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 shadow-xs transition-colors hover:border-foreground/20 hover:bg-accent/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span
                      className={cn(
                        "grid size-9 place-items-center rounded-lg bg-muted",
                        status.className,
                      )}
                    >
                      <StatusIcon className="size-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{thread.title}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        <span className={status.className}>{status.label}</span>
                        <span>
                          {thread.session?.providerName ?? thread.modelSelection.instanceId}
                        </span>
                        {thread.branch ? <span className="font-mono">{thread.branch}</span> : null}
                      </span>
                    </span>
                    <ArrowRightIcon className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </Link>
                );
              })}
            </div>
          </section>
        )}
      </main>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/projects/$environmentId/$projectId")({
  beforeLoad: () => {
    if (currentUiGeneration === "legacy") throw redirect({ to: "/" });
  },
  component: ProjectOverviewRouteView,
});
