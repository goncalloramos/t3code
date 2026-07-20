import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import {
  DEFAULT_AUTOMATIC_GIT_FETCH_INTERVAL,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthReviewWriteScope,
  AuthRelayWriteScope,
  AuthTerminalOperateScope,
  AuthAccessReadScope,
  type AuthEnvironmentScope,
  ORCHESTRATION_WS_METHODS,
  EnvironmentAuthorizationError,
  WS_METHODS,
  WsRpcGroup,
} from "@t3tools/contracts";
import { HttpRouter, HttpServerRequest, HttpServerRespondable } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

import * as CheckpointDiffQuery from "./checkpointing/CheckpointDiffQuery.ts";
import * as ServerConfig from "./config.ts";
import * as Keybindings from "./keybindings.ts";
import * as ExternalLauncher from "./process/externalLauncher.ts";
import * as OrchestrationEngine from "./orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "./orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  observeRpcEffect as instrumentRpcEffect,
  observeRpcStream as instrumentRpcStream,
  observeRpcStreamEffect as instrumentRpcStreamEffect,
} from "./observability/RpcInstrumentation.ts";
import * as ProviderRegistry from "./provider/Services/ProviderRegistry.ts";
import * as ProviderMaintenanceRunner from "./provider/providerMaintenanceRunner.ts";
import * as ServerLifecycleEvents from "./serverLifecycleEvents.ts";
import * as ServerRuntimeStartup from "./serverRuntimeStartup.ts";
import * as ServerSettings from "./serverSettings.ts";
import * as TerminalManager from "./terminal/Manager.ts";
import * as PreviewAutomationBroker from "./mcp/PreviewAutomationBroker.ts";
import * as PreviewManager from "./preview/Manager.ts";
import * as PortScanner from "./preview/PortScanner.ts";
import * as WorkspaceEntries from "./workspace/WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "./workspace/WorkspaceFileSystem.ts";
import * as VcsStatusBroadcaster from "./vcs/VcsStatusBroadcaster.ts";
import * as VcsProvisioningService from "./vcs/VcsProvisioningService.ts";
import * as GitWorkflowService from "./git/GitWorkflowService.ts";
import * as ReviewService from "./review/ReviewService.ts";
import * as ProjectSetupScriptRunner from "./project/ProjectSetupScriptRunner.ts";
import * as RepositoryIdentityResolver from "./project/RepositoryIdentityResolver.ts";
import * as ServerEnvironment from "./environment/ServerEnvironment.ts";
import * as EnvironmentAuth from "./auth/EnvironmentAuth.ts";
import * as ProcessDiagnostics from "./diagnostics/ProcessDiagnostics.ts";
import * as ProcessResourceMonitor from "./diagnostics/ProcessResourceMonitor.ts";
import * as SourceControlDiscovery from "./sourceControl/SourceControlDiscovery.ts";
import * as SourceControlRepositoryService from "./sourceControl/SourceControlRepositoryService.ts";
import * as AzureDevOpsCli from "./sourceControl/AzureDevOpsCli.ts";
import * as BitbucketApi from "./sourceControl/BitbucketApi.ts";
import * as GitHubCli from "./sourceControl/GitHubCli.ts";
import * as GitLabCli from "./sourceControl/GitLabCli.ts";
import * as SourceControlProviderRegistry from "./sourceControl/SourceControlProviderRegistry.ts";
import * as GitVcsDriver from "./vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "./vcs/VcsDriverRegistry.ts";
import * as VcsProjectConfig from "./vcs/VcsProjectConfig.ts";
import * as VcsProcess from "./vcs/VcsProcess.ts";
import * as PairingGrantStore from "./auth/PairingGrantStore.ts";
import * as SessionStore from "./auth/SessionStore.ts";
import { failEnvironmentAuthInvalid, failEnvironmentInternal } from "./auth/http.ts";
import { makeTerminalRpcHandlers } from "./rpc/terminal.ts";
import { makePreviewRpcHandlers } from "./rpc/preview.ts";
import { makeProjectRpcHandlers } from "./rpc/projects.ts";
import { makeFilesystemRpcHandlers } from "./rpc/filesystem.ts";
import { makeAccessRpcHandlers } from "./rpc/access.ts";
import { makeServerRpcHandlers } from "./rpc/server.ts";
import { makeSettingsRpcHandlers } from "./rpc/settings.ts";
import { makeProviderRpcHandlers } from "./rpc/providers.ts";
import { makeGitRpcHandlers } from "./rpc/git.ts";
import { makeOrchestrationRpcHandlers } from "./rpc/orchestration.ts";
import { makeVcsStatusRpcHandlers } from "./rpc/vcs.ts";
import { makeSourceControlRpcHandlers } from "./rpc/sourceControl.ts";
import { makeRelayRpcHandlers } from "./rpc/relay.ts";
import * as RelayClient from "@t3tools/shared/relayClient";

export const RPC_REQUIRED_SCOPE = new Map<string, AuthEnvironmentScope>([
  [ORCHESTRATION_WS_METHODS.dispatchCommand, AuthOrchestrationOperateScope],
  [ORCHESTRATION_WS_METHODS.getTurnDiff, AuthOrchestrationReadScope],
  [ORCHESTRATION_WS_METHODS.getFullThreadDiff, AuthOrchestrationReadScope],
  [ORCHESTRATION_WS_METHODS.replayEvents, AuthOrchestrationReadScope],
  [ORCHESTRATION_WS_METHODS.subscribeShell, AuthOrchestrationReadScope],
  [ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot, AuthOrchestrationReadScope],
  [ORCHESTRATION_WS_METHODS.subscribeThread, AuthOrchestrationReadScope],
  [WS_METHODS.serverGetConfig, AuthOrchestrationReadScope],
  [WS_METHODS.serverRefreshProviders, AuthOrchestrationOperateScope],
  [WS_METHODS.serverUpdateProvider, AuthOrchestrationOperateScope],
  [WS_METHODS.serverUpsertKeybinding, AuthOrchestrationOperateScope],
  [WS_METHODS.serverRemoveKeybinding, AuthOrchestrationOperateScope],
  [WS_METHODS.serverGetSettings, AuthOrchestrationReadScope],
  [WS_METHODS.serverUpdateSettings, AuthOrchestrationOperateScope],
  [WS_METHODS.serverDiscoverSourceControl, AuthOrchestrationReadScope],
  [WS_METHODS.serverGetTraceDiagnostics, AuthOrchestrationReadScope],
  [WS_METHODS.serverGetProcessDiagnostics, AuthOrchestrationReadScope],
  [WS_METHODS.serverGetProcessResourceHistory, AuthOrchestrationReadScope],
  [WS_METHODS.serverSignalProcess, AuthOrchestrationOperateScope],
  [WS_METHODS.cloudGetRelayClientStatus, AuthRelayWriteScope],
  [WS_METHODS.cloudInstallRelayClient, AuthRelayWriteScope],
  [WS_METHODS.sourceControlLookupRepository, AuthOrchestrationReadScope],
  [WS_METHODS.sourceControlCloneRepository, AuthOrchestrationOperateScope],
  [WS_METHODS.sourceControlPublishRepository, AuthOrchestrationOperateScope],
  [WS_METHODS.projectsListEntries, AuthOrchestrationReadScope],
  [WS_METHODS.projectsReadFile, AuthOrchestrationReadScope],
  [WS_METHODS.projectsSearchEntries, AuthOrchestrationReadScope],
  [WS_METHODS.projectsWriteFile, AuthOrchestrationOperateScope],
  [WS_METHODS.shellOpenInEditor, AuthOrchestrationOperateScope],
  [WS_METHODS.filesystemBrowse, AuthOrchestrationReadScope],
  [WS_METHODS.assetsCreateUrl, AuthOrchestrationReadScope],
  [WS_METHODS.subscribeVcsStatus, AuthOrchestrationReadScope],
  [WS_METHODS.vcsRefreshStatus, AuthOrchestrationReadScope],
  [WS_METHODS.vcsPull, AuthOrchestrationOperateScope],
  [WS_METHODS.gitRunStackedAction, AuthOrchestrationOperateScope],
  [WS_METHODS.gitResolvePullRequest, AuthOrchestrationOperateScope],
  [WS_METHODS.gitPreparePullRequestThread, AuthOrchestrationOperateScope],
  [WS_METHODS.vcsListRefs, AuthOrchestrationReadScope],
  [WS_METHODS.vcsCreateWorktree, AuthOrchestrationOperateScope],
  [WS_METHODS.vcsRemoveWorktree, AuthOrchestrationOperateScope],
  [WS_METHODS.vcsCreateRef, AuthOrchestrationOperateScope],
  [WS_METHODS.vcsSwitchRef, AuthOrchestrationOperateScope],
  [WS_METHODS.vcsInit, AuthOrchestrationOperateScope],
  [WS_METHODS.reviewGetDiffPreview, AuthReviewWriteScope],
  [WS_METHODS.terminalOpen, AuthTerminalOperateScope],
  [WS_METHODS.terminalAttach, AuthTerminalOperateScope],
  [WS_METHODS.terminalWrite, AuthTerminalOperateScope],
  [WS_METHODS.terminalResize, AuthTerminalOperateScope],
  [WS_METHODS.terminalClear, AuthTerminalOperateScope],
  [WS_METHODS.terminalRestart, AuthTerminalOperateScope],
  [WS_METHODS.terminalClose, AuthTerminalOperateScope],
  [WS_METHODS.subscribeTerminalEvents, AuthTerminalOperateScope],
  [WS_METHODS.subscribeTerminalMetadata, AuthTerminalOperateScope],
  [WS_METHODS.previewOpen, AuthOrchestrationOperateScope],
  [WS_METHODS.previewNavigate, AuthOrchestrationOperateScope],
  [WS_METHODS.previewResize, AuthOrchestrationOperateScope],
  [WS_METHODS.previewRefresh, AuthOrchestrationOperateScope],
  [WS_METHODS.previewClose, AuthOrchestrationOperateScope],
  [WS_METHODS.previewList, AuthOrchestrationReadScope],
  [WS_METHODS.previewReportStatus, AuthOrchestrationOperateScope],
  [WS_METHODS.previewAutomationConnect, AuthOrchestrationOperateScope],
  [WS_METHODS.previewAutomationRespond, AuthOrchestrationOperateScope],
  [WS_METHODS.previewAutomationFocusHost, AuthOrchestrationOperateScope],
  [WS_METHODS.subscribePreviewEvents, AuthOrchestrationReadScope],
  [WS_METHODS.subscribeDiscoveredLocalServers, AuthOrchestrationReadScope],
  [WS_METHODS.subscribeServerConfig, AuthOrchestrationReadScope],
  [WS_METHODS.subscribeServerLifecycle, AuthOrchestrationReadScope],
  [WS_METHODS.subscribeAuthAccess, AuthAccessReadScope],
]);

const makeWsRpcLayer = (
  currentSession: EnvironmentAuth.AuthenticatedSession,
  previewAutomationBroker: PreviewAutomationBroker.PreviewAutomationBroker["Service"],
) =>
  WsRpcGroup.toLayer(
    Effect.gen(function* () {
      const currentSessionId = currentSession.sessionId;
      const crypto = yield* Crypto.Crypto;
      const projectionSnapshotQuery = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
      const orchestrationEngine = yield* OrchestrationEngine.OrchestrationEngineService;
      const checkpointDiffQuery = yield* CheckpointDiffQuery.CheckpointDiffQuery;
      const keybindings = yield* Keybindings.Keybindings;
      const externalLauncher = yield* ExternalLauncher.ExternalLauncher;
      const gitWorkflow = yield* GitWorkflowService.GitWorkflowService;
      const review = yield* ReviewService.ReviewService;
      const vcsProvisioning = yield* VcsProvisioningService.VcsProvisioningService;
      const vcsStatusBroadcaster = yield* VcsStatusBroadcaster.VcsStatusBroadcaster;
      const terminalManager = yield* TerminalManager.TerminalManager;
      const previewManager = yield* PreviewManager.PreviewManager;
      const portDiscovery = yield* PortScanner.PortDiscovery;
      const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
      const providerMaintenanceRunner = yield* ProviderMaintenanceRunner.ProviderMaintenanceRunner;
      const config = yield* ServerConfig.ServerConfig;
      const lifecycleEvents = yield* ServerLifecycleEvents.ServerLifecycleEvents;
      const serverSettings = yield* ServerSettings.ServerSettingsService;
      const startup = yield* ServerRuntimeStartup.ServerRuntimeStartup;
      const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;
      const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
      const projectSetupScriptRunner = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;
      const repositoryIdentityResolver =
        yield* RepositoryIdentityResolver.RepositoryIdentityResolver;
      const serverEnvironment = yield* ServerEnvironment.ServerEnvironment;
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      const sourceControlDiscovery = yield* SourceControlDiscovery.SourceControlDiscovery;
      const automaticGitFetchInterval = serverSettings.getSettings.pipe(
        Effect.map((settings) => settings.automaticGitFetchInterval),
        Effect.catch((cause) =>
          Effect.logWarning("Failed to read automatic Git fetch interval setting", {
            detail: cause.message,
          }).pipe(Effect.as(DEFAULT_AUTOMATIC_GIT_FETCH_INTERVAL)),
        ),
      );
      const sourceControlRepositories =
        yield* SourceControlRepositoryService.SourceControlRepositoryService;
      const bootstrapCredentials = yield* PairingGrantStore.PairingGrantStore;
      const sessions = yield* SessionStore.SessionStore;
      const processDiagnostics = yield* ProcessDiagnostics.ProcessDiagnostics;
      const processResourceMonitor = yield* ProcessResourceMonitor.ProcessResourceMonitor;
      const relayClient = yield* RelayClient.RelayClient;
      const authorizationError = (requiredScope: AuthEnvironmentScope) =>
        new EnvironmentAuthorizationError({
          message: `The authenticated token is missing required scope: ${requiredScope}.`,
          requiredScope,
        });
      const authorizeEffect = <A, E, R>(
        requiredScope: AuthEnvironmentScope,
        effect: Effect.Effect<A, E, R>,
      ): Effect.Effect<A, E | EnvironmentAuthorizationError, R> =>
        currentSession.scopes.includes(requiredScope)
          ? effect
          : Effect.fail(authorizationError(requiredScope));
      const authorizeStream = <A, E, R>(
        requiredScope: AuthEnvironmentScope,
        stream: Stream.Stream<A, E, R>,
      ): Stream.Stream<A, E | EnvironmentAuthorizationError, R> =>
        currentSession.scopes.includes(requiredScope)
          ? stream
          : Stream.fail(authorizationError(requiredScope));
      const requiredScopeForMethod = (method: string): AuthEnvironmentScope => {
        const requiredScope = RPC_REQUIRED_SCOPE.get(method);
        if (requiredScope === undefined) {
          throw new Error(`RPC method ${method} has no declared authorization scope.`);
        }
        return requiredScope;
      };
      const observeRpcEffect = <A, E, R>(
        method: string,
        effect: Effect.Effect<A, E, R>,
        traceAttributes?: Readonly<Record<string, unknown>>,
      ) =>
        instrumentRpcEffect(
          method,
          authorizeEffect(requiredScopeForMethod(method), effect),
          traceAttributes,
        );
      const observeRpcStream = <A, E, R>(
        method: string,
        stream: Stream.Stream<A, E, R>,
        traceAttributes?: Readonly<Record<string, unknown>>,
      ) =>
        instrumentRpcStream(
          method,
          authorizeStream(requiredScopeForMethod(method), stream),
          traceAttributes,
        );
      const observeRpcStreamEffect = <A, StreamError, StreamContext, EffectError, EffectContext>(
        method: string,
        effect: Effect.Effect<
          Stream.Stream<A, StreamError, StreamContext>,
          EffectError,
          EffectContext
        >,
        traceAttributes?: Readonly<Record<string, unknown>>,
      ) =>
        instrumentRpcStreamEffect(
          method,
          authorizeEffect(requiredScopeForMethod(method), effect),
          traceAttributes,
        );
      const orchestrationRpcHandlers = makeOrchestrationRpcHandlers(
        {
          checkpointDiffQuery,
          crypto,
          gitWorkflow,
          orchestrationEngine,
          projectSetupScriptRunner,
          projectionSnapshotQuery,
          repositoryIdentityResolver,
          startup,
          terminalManager,
          vcsStatusBroadcaster,
        },
        {
          observeEffect: observeRpcEffect,
          observeStreamEffect: observeRpcStreamEffect,
        },
      );

      return WsRpcGroup.of({
        ...orchestrationRpcHandlers,
        ...makeProviderRpcHandlers(
          { providerMaintenanceRunner, providerRegistry },
          { observeEffect: observeRpcEffect },
        ),
        ...makeSettingsRpcHandlers(
          { keybindings, serverSettings },
          { observeEffect: observeRpcEffect },
        ),
        ...makeServerRpcHandlers(
          {
            config,
            externalLauncher,
            keybindings,
            lifecycleEvents,
            processDiagnostics,
            processResourceMonitor,
            providerRegistry,
            serverAuth,
            serverEnvironment,
            serverSettings,
            sourceControlDiscovery,
          },
          {
            observeEffect: observeRpcEffect,
            observeStreamEffect: observeRpcStreamEffect,
          },
        ),
        ...makeRelayRpcHandlers(relayClient, {
          observeEffect: observeRpcEffect,
          observeStream: observeRpcStream,
        }),
        ...makeSourceControlRpcHandlers(
          { sourceControlRepositories, vcsStatusBroadcaster },
          { observeEffect: observeRpcEffect },
        ),
        ...makeProjectRpcHandlers(
          { workspaceEntries, workspaceFileSystem },
          { observeEffect: observeRpcEffect },
        ),
        ...makeFilesystemRpcHandlers(
          { externalLauncher, projectionSnapshotQuery, workspaceEntries },
          { observeEffect: observeRpcEffect },
        ),
        ...makeVcsStatusRpcHandlers(
          { automaticGitFetchInterval, vcsStatusBroadcaster },
          { observeEffect: observeRpcEffect, observeStream: observeRpcStream },
        ),
        ...makeGitRpcHandlers(
          { gitWorkflow, review, vcsProvisioning, vcsStatusBroadcaster },
          { observeEffect: observeRpcEffect, observeStream: observeRpcStream },
        ),
        ...makeTerminalRpcHandlers(terminalManager, {
          observeEffect: observeRpcEffect,
          observeStream: observeRpcStream,
        }),
        ...makePreviewRpcHandlers(
          { portDiscovery, previewAutomationBroker, previewManager },
          {
            observeEffect: observeRpcEffect,
            observeStream: observeRpcStream,
            observeStreamEffect: observeRpcStreamEffect,
          },
        ),
        ...makeAccessRpcHandlers(
          { currentSessionId, serverAuth, bootstrapCredentials, sessions },
          { observeStreamEffect: observeRpcStreamEffect },
        ),
      });
    }),
  );

export const websocketRpcRouteLayer = Layer.unwrap(
  Effect.gen(function* () {
    const previewAutomationBroker = yield* PreviewAutomationBroker.PreviewAutomationBroker;
    return HttpRouter.add(
      "GET",
      "/ws",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
        const sessions = yield* SessionStore.SessionStore;
        const session = yield* serverAuth.authenticateWebSocketUpgrade(request).pipe(
          Effect.catchIf(EnvironmentAuth.isServerAuthCredentialError, (error) =>
            failEnvironmentAuthInvalid(EnvironmentAuth.serverAuthCredentialReason(error)),
          ),
          Effect.catchIf(EnvironmentAuth.isServerAuthInternalError, (error) =>
            failEnvironmentInternal("internal_error", error),
          ),
        );
        const rpcWebSocketHttpEffect = yield* RpcServer.toHttpEffectWebsocket(WsRpcGroup, {
          disableTracing: true,
        }).pipe(
          Effect.provide(
            makeWsRpcLayer(session, previewAutomationBroker).pipe(
              Layer.provideMerge(RpcSerialization.layerJson),
              Layer.provide(ProviderMaintenanceRunner.layer),
              Layer.provide(
                SourceControlDiscovery.layer.pipe(
                  Layer.provide(
                    SourceControlProviderRegistry.layer.pipe(
                      Layer.provide(
                        Layer.mergeAll(
                          AzureDevOpsCli.layer,
                          BitbucketApi.layer,
                          GitHubCli.layer,
                          GitLabCli.layer,
                        ),
                      ),
                      Layer.provideMerge(GitVcsDriver.layer),
                      Layer.provide(
                        VcsDriverRegistry.layer.pipe(Layer.provide(VcsProjectConfig.layer)),
                      ),
                    ),
                  ),
                  Layer.provide(VcsProcess.layer),
                ),
              ),
            ),
          ),
        );
        return yield* Effect.acquireUseRelease(
          sessions.markConnected(session.sessionId),
          () => rpcWebSocketHttpEffect,
          () => sessions.markDisconnected(session.sessionId),
        );
      }).pipe(
        Effect.catchTags({
          EnvironmentAuthInvalidError: HttpServerRespondable.toResponse,
          EnvironmentInternalError: HttpServerRespondable.toResponse,
        }),
      ),
    );
  }),
);
