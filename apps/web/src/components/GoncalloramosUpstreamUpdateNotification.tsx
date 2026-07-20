import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { WorkspaceCommands } from "@t3tools/client-runtime/workspace";
import {
  DEFAULT_MODEL,
  DEFAULT_RUNTIME_MODE,
  ProviderInstanceId,
  type ModelSelection,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { GitCompareArrowsIcon } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";

import { APP_STAGE_LABEL } from "../branding";
import {
  buildGoncalloramosUpstreamAnalysisPrompt,
  GONCALLORAMOS_UPSTREAM_REPOSITORY,
  dismissGoncalloramosUpstreamRelease,
  findGoncalloramosT3RepositoryProject,
  isGoncalloramosUpstreamReleaseDismissed,
  resolveNewGoncalloramosUpstreamRelease,
  type GoncalloramosUpstreamRelease,
} from "../goncalloramosUpstreamUpdate";
import { useDesktopUpdateState } from "../state/desktopUpdate";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { runWorkspaceCommand, useWorkspaceProjects } from "../state/workspace";
import { newMessageId, newThreadId } from "../lib/utils";
import { waitForStartedServerThread } from "./ChatView.logic";
import { stackedThreadToast, toastManager } from "./ui/toast";

const RELEASE_ENDPOINT = `https://api.github.com/repos/${GONCALLORAMOS_UPSTREAM_REPOSITORY}/releases/latest`;
let releaseRequest: Promise<unknown> | null = null;

function fetchLatestUpstreamRelease(): Promise<unknown> {
  releaseRequest ??= fetch(RELEASE_ENDPOINT, {
    headers: { Accept: "application/vnd.github+json" },
  }).then((response) => {
    if (!response.ok) {
      throw new Error(`GitHub release check failed with HTTP ${response.status}.`);
    }
    return response.json() as Promise<unknown>;
  });
  return releaseRequest;
}

/**
 * Goncalloramos builds watch official releases but never download or install them.
 * Analysis runs in a Plan-mode Codex thread so implementation remains behind
 * the existing explicit plan approval action.
 */
export function GoncalloramosUpstreamUpdateNotification() {
  const navigate = useNavigate();
  const projects = useWorkspaceProjects();
  const desktopUpdateState = useDesktopUpdateState();
  const startThreadTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const toastIdRef = useRef<ReturnType<typeof toastManager.add> | null>(null);
  const dismissedRef = useRef(false);
  const analysisStartedRef = useRef(false);

  const closeNotification = useCallback((releaseVersion?: string) => {
    dismissedRef.current = true;
    if (releaseVersion) {
      dismissGoncalloramosUpstreamRelease(window.sessionStorage, releaseVersion);
    }
    const toastId = toastIdRef.current;
    if (toastId !== null) {
      toastManager.close(toastId);
      toastIdRef.current = null;
    }
  }, []);

  const startAnalysis = useCallback(
    async (release: GoncalloramosUpstreamRelease, currentVersion: string) => {
      if (analysisStartedRef.current) return;
      analysisStartedRef.current = true;

      const project = findGoncalloramosT3RepositoryProject(projects);
      if (!project) {
        analysisStartedRef.current = false;
        toastManager.add(
          stackedThreadToast({
            type: "warning",
            title: "Open the goncalloramos T3 repository first",
            description:
              "Add or open the T3 Code - goncalloramos repository as a project, then run Analyse again.",
          }),
        );
        return;
      }

      const toastId = toastIdRef.current;
      if (toastId !== null) {
        toastManager.update(toastId, {
          type: "loading",
          title: `Starting ${release.tagName} analysis…`,
          description: "Opening a read-only comparison thread in Plan mode.",
          timeout: 0,
          data: { hideCopyButton: true },
        });
      }

      const createdAt = new Date().toISOString();
      const threadId = newThreadId();
      const title = `Analyse T3 Code ${release.tagName}`;
      const modelSelection: ModelSelection = project.defaultModelSelection ?? {
        instanceId: ProviderInstanceId.make("codex"),
        model: DEFAULT_MODEL,
      };
      const result = await startThreadTurn({
        environmentId: project.environmentId,
        input: {
          threadId,
          message: {
            messageId: newMessageId(),
            role: "user",
            text: buildGoncalloramosUpstreamAnalysisPrompt({ currentVersion, release }),
            attachments: [],
          },
          modelSelection,
          titleSeed: title,
          runtimeMode: DEFAULT_RUNTIME_MODE,
          interactionMode: "plan",
          bootstrap: {
            createThread: {
              projectId: project.id,
              title,
              modelSelection,
              runtimeMode: DEFAULT_RUNTIME_MODE,
              interactionMode: "plan",
              branch: null,
              worktreePath: null,
              createdAt,
            },
          },
          createdAt,
        },
      });

      if (result._tag === "Failure") {
        analysisStartedRef.current = false;
        const error = squashAtomCommandFailure(result);
        if (toastId !== null) toastManager.close(toastId);
        toastIdRef.current = null;
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not start update analysis",
            description: error instanceof Error ? error.message : "An unknown error occurred.",
          }),
        );
        return;
      }

      await waitForStartedServerThread(scopeThreadRef(project.environmentId, threadId));
      if (toastId !== null) toastManager.close(toastId);
      toastIdRef.current = null;
      await runWorkspaceCommand(WorkspaceCommands.selectThread(project.environmentId, threadId));
      await navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId: project.environmentId, threadId },
      });
    },
    [navigate, projects, startThreadTurn],
  );

  useEffect(() => {
    if (
      APP_STAGE_LABEL !== "Stable" ||
      !window.desktopBridge ||
      !desktopUpdateState ||
      dismissedRef.current ||
      analysisStartedRef.current ||
      toastIdRef.current !== null
    ) {
      return;
    }

    let cancelled = false;
    void fetchLatestUpstreamRelease()
      .then((value) => {
        if (cancelled || dismissedRef.current || analysisStartedRef.current) return;
        const release = resolveNewGoncalloramosUpstreamRelease(
          desktopUpdateState.currentVersion,
          value,
        );
        if (
          !release ||
          isGoncalloramosUpstreamReleaseDismissed(window.sessionStorage, release.version)
        ) {
          return;
        }

        let toastId!: ReturnType<typeof toastManager.add>;
        const analyse = () => {
          void startAnalysis(release, desktopUpdateState.currentVersion);
        };
        const dismiss = () => closeNotification(release.version);
        toastId = toastManager.add(
          stackedThreadToast({
            type: "info",
            title: `T3 Code ${release.version} is available`,
            description:
              "The custom app will not install it automatically. Analyse it against this fork first.",
            timeout: 0,
            actionProps: { children: "Analyse", onClick: analyse },
            actionVariant: "default",
            data: {
              leadingIcon: <GitCompareArrowsIcon aria-hidden="true" className="size-4" />,
              hideCopyButton: true,
              onClose: dismiss,
              secondaryActionProps: {
                children: "Dismiss until restart",
                onClick: dismiss,
              },
              secondaryActionVariant: "outline",
            },
          }),
        );
        toastIdRef.current = toastId;
      })
      .catch((error: unknown) => {
        // A watcher failure must not disrupt startup or enable the official updater.
        console.warn("Unable to check the latest official T3 Code release.", error);
      });

    return () => {
      cancelled = true;
    };
  }, [closeNotification, desktopUpdateState, startAnalysis]);

  useEffect(
    () => () => {
      const toastId = toastIdRef.current;
      if (toastId !== null) toastManager.close(toastId);
    },
    [],
  );

  return null;
}
