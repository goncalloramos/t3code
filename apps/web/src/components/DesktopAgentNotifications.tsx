import {
  scopedProjectKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import { WorkspaceCommands } from "@t3tools/client-runtime/workspace";
import type { DesktopAgentNotification } from "@t3tools/contracts";
import { projectThreadAwareness, type AgentAwarenessPhase } from "@t3tools/shared/agentAwareness";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef } from "react";

import { runWorkspaceCommand, useWorkspaceProjects, useWorkspaceThreads } from "../state/workspace";
import { resolveDesktopAgentNotificationTransition } from "./DesktopAgentNotifications.logic";

export function DesktopAgentNotifications() {
  const bridge = window.desktopBridge;
  const navigate = useNavigate();
  const projects = useWorkspaceProjects();
  const threads = useWorkspaceThreads();
  const phasesRef = useRef(new Map<string, AgentAwarenessPhase>());
  const initializedRef = useRef(false);
  const projectsByKey = useMemo(
    () =>
      new Map(
        projects.map((project) => [
          scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
          project,
        ]),
      ),
    [projects],
  );

  useEffect(() => {
    if (!bridge) return;

    const removeClickListener = bridge.onAgentNotificationClick(({ environmentId, threadId }) => {
      void runWorkspaceCommand(WorkspaceCommands.selectThread(environmentId, threadId)).then(() =>
        navigate({
          to: "/$environmentId/$threadId",
          params: { environmentId, threadId },
        }),
      );
    });
    return removeClickListener;
  }, [bridge, navigate]);

  useEffect(() => {
    if (!bridge) return;

    const nextPhases = new Map<string, AgentAwarenessPhase>();
    for (const thread of threads) {
      const project = projectsByKey.get(
        scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId)),
      );
      if (!project) continue;

      const awareness = projectThreadAwareness({
        environmentId: thread.environmentId,
        project,
        thread,
      });
      if (!awareness) continue;

      const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
      nextPhases.set(key, awareness.phase);
      if (!initializedRef.current) continue;

      const transition = resolveDesktopAgentNotificationTransition(
        phasesRef.current.get(key),
        awareness.phase,
      );
      if (!transition) continue;

      const notification: DesktopAgentNotification =
        transition === "input"
          ? {
              kind: "input",
              environmentId: thread.environmentId,
              threadId: thread.id,
              title: `Answer needed — ${thread.title}`,
              body: `${project.title} · The agent is waiting for your input.`,
            }
          : {
              kind: "completion",
              environmentId: thread.environmentId,
              threadId: thread.id,
              title: `Task complete — ${thread.title}`,
              body: `${project.title} · Open the chat to review the result.`,
            };
      void bridge.showAgentNotification(notification).catch(() => undefined);
    }

    phasesRef.current = nextPhases;
    initializedRef.current = true;
  }, [bridge, projectsByKey, threads]);

  return null;
}
