import { WS_METHODS } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import type * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import type * as ServerConfig from "../config.ts";
import type * as ProcessDiagnostics from "../diagnostics/ProcessDiagnostics.ts";
import type * as ProcessResourceMonitor from "../diagnostics/ProcessResourceMonitor.ts";
import type * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import type * as Keybindings from "../keybindings.ts";
import type * as ExternalLauncher from "../process/externalLauncher.ts";
import type * as ProviderRegistry from "../provider/Services/ProviderRegistry.ts";
import type * as ServerLifecycleEvents from "../serverLifecycleEvents.ts";
import * as ServerSettings from "../serverSettings.ts";
import type * as SourceControlDiscovery from "../sourceControl/SourceControlDiscovery.ts";
import * as TraceDiagnostics from "../diagnostics/TraceDiagnostics.ts";
import type { RpcHandlerObservers } from "./handlers.ts";

const PROVIDER_STATUS_DEBOUNCE_MS = 200;

export const SERVER_RPC_METHODS = [
  WS_METHODS.serverGetConfig,
  WS_METHODS.serverDiscoverSourceControl,
  WS_METHODS.serverGetTraceDiagnostics,
  WS_METHODS.serverGetProcessDiagnostics,
  WS_METHODS.serverGetProcessResourceHistory,
  WS_METHODS.serverSignalProcess,
  WS_METHODS.subscribeServerConfig,
  WS_METHODS.subscribeServerLifecycle,
] as const;

export function makeServerRpcHandlers(
  services: {
    readonly config: ServerConfig.ServerConfig["Service"];
    readonly externalLauncher: Pick<
      ExternalLauncher.ExternalLauncher["Service"],
      "resolveAvailableEditors"
    >;
    readonly keybindings: Pick<
      Keybindings.Keybindings["Service"],
      "loadConfigState" | "streamChanges"
    >;
    readonly lifecycleEvents: Pick<
      ServerLifecycleEvents.ServerLifecycleEvents["Service"],
      "snapshot" | "stream"
    >;
    readonly processDiagnostics: Pick<
      ProcessDiagnostics.ProcessDiagnostics["Service"],
      "read" | "signal"
    >;
    readonly processResourceMonitor: Pick<
      ProcessResourceMonitor.ProcessResourceMonitor["Service"],
      "readHistory"
    >;
    readonly providerRegistry: Pick<
      ProviderRegistry.ProviderRegistry["Service"],
      "getProviders" | "refresh" | "streamChanges"
    >;
    readonly serverAuth: Pick<EnvironmentAuth.EnvironmentAuth["Service"], "getDescriptor">;
    readonly serverEnvironment: Pick<
      ServerEnvironment.ServerEnvironment["Service"],
      "getDescriptor"
    >;
    readonly serverSettings: Pick<
      ServerSettings.ServerSettingsService["Service"],
      "getSettings" | "streamChanges"
    >;
    readonly sourceControlDiscovery: Pick<
      SourceControlDiscovery.SourceControlDiscovery["Service"],
      "discover"
    >;
  },
  {
    observeEffect,
    observeStreamEffect,
  }: Pick<RpcHandlerObservers, "observeEffect" | "observeStreamEffect">,
) {
  const traceAttributes = { "rpc.aggregate": "server" } as const;
  const {
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
  } = services;

  const loadServerConfig = Effect.gen(function* () {
    const keybindingsConfig = yield* keybindings.loadConfigState;
    const providers = yield* providerRegistry.getProviders;
    const settings = ServerSettings.redactServerSettingsForClient(
      yield* serverSettings.getSettings,
    );
    const environment = yield* serverEnvironment.getDescriptor;
    const auth = yield* serverAuth.getDescriptor();

    return {
      environment,
      auth,
      cwd: config.cwd,
      keybindingsConfigPath: config.keybindingsConfigPath,
      keybindings: keybindingsConfig.keybindings,
      issues: keybindingsConfig.issues,
      providers,
      availableEditors: yield* externalLauncher.resolveAvailableEditors(),
      observability: {
        logsDirectoryPath: config.logsDir,
        localTracingEnabled: true,
        ...(config.otlpTracesUrl !== undefined ? { otlpTracesUrl: config.otlpTracesUrl } : {}),
        otlpTracesEnabled: config.otlpTracesUrl !== undefined,
        ...(config.otlpMetricsUrl !== undefined ? { otlpMetricsUrl: config.otlpMetricsUrl } : {}),
        otlpMetricsEnabled: config.otlpMetricsUrl !== undefined,
      },
      settings,
    };
  });

  return {
    [WS_METHODS.serverGetConfig]: (_input: {}) =>
      observeEffect(WS_METHODS.serverGetConfig, loadServerConfig, traceAttributes),
    [WS_METHODS.serverDiscoverSourceControl]: (_input: {}) =>
      observeEffect(
        WS_METHODS.serverDiscoverSourceControl,
        sourceControlDiscovery.discover,
        traceAttributes,
      ),
    [WS_METHODS.serverGetTraceDiagnostics]: (_input: {}) =>
      observeEffect(
        WS_METHODS.serverGetTraceDiagnostics,
        TraceDiagnostics.readTraceDiagnostics({
          traceFilePath: config.serverTracePath,
          maxFiles: config.traceMaxFiles,
        }),
        traceAttributes,
      ),
    [WS_METHODS.serverGetProcessDiagnostics]: (_input: {}) =>
      observeEffect(
        WS_METHODS.serverGetProcessDiagnostics,
        processDiagnostics.read,
        traceAttributes,
      ),
    [WS_METHODS.serverGetProcessResourceHistory]: (
      input: Parameters<typeof processResourceMonitor.readHistory>[0],
    ) =>
      observeEffect(
        WS_METHODS.serverGetProcessResourceHistory,
        processResourceMonitor.readHistory(input),
        traceAttributes,
      ),
    [WS_METHODS.serverSignalProcess]: (input: Parameters<typeof processDiagnostics.signal>[0]) =>
      observeEffect(
        WS_METHODS.serverSignalProcess,
        processDiagnostics.signal(input),
        traceAttributes,
      ),
    [WS_METHODS.subscribeServerConfig]: (_input: {}) =>
      observeStreamEffect(
        WS_METHODS.subscribeServerConfig,
        Effect.gen(function* () {
          const keybindingsUpdates = keybindings.streamChanges.pipe(
            Stream.map((event) => ({
              version: 1 as const,
              type: "keybindingsUpdated" as const,
              payload: {
                keybindings: event.keybindings,
                issues: event.issues,
              },
            })),
          );
          const providerStatuses = providerRegistry.streamChanges.pipe(
            Stream.map((providers) => ({
              version: 1 as const,
              type: "providerStatuses" as const,
              payload: { providers },
            })),
            Stream.debounce(Duration.millis(PROVIDER_STATUS_DEBOUNCE_MS)),
          );
          const settingsUpdates = serverSettings.streamChanges.pipe(
            Stream.map((settings) => ServerSettings.redactServerSettingsForClient(settings)),
            Stream.map((settings) => ({
              version: 1 as const,
              type: "settingsUpdated" as const,
              payload: { settings },
            })),
          );

          yield* providerRegistry
            .refresh()
            .pipe(Effect.ignoreCause({ log: true }), Effect.forkScoped);

          return Stream.concat(
            Stream.make({
              version: 1 as const,
              type: "snapshot" as const,
              config: yield* loadServerConfig,
            }),
            Stream.merge(keybindingsUpdates, Stream.merge(providerStatuses, settingsUpdates)),
          );
        }),
        traceAttributes,
      ),
    [WS_METHODS.subscribeServerLifecycle]: (_input: {}) =>
      observeStreamEffect(
        WS_METHODS.subscribeServerLifecycle,
        Effect.gen(function* () {
          const snapshot = yield* lifecycleEvents.snapshot;
          const snapshotEvents = Array.from(snapshot.events).toSorted(
            (left, right) => left.sequence - right.sequence,
          );
          const liveEvents = lifecycleEvents.stream.pipe(
            Stream.filter((event) => event.sequence > snapshot.sequence),
          );
          return Stream.concat(Stream.fromIterable(snapshotEvents), liveEvents);
        }),
        traceAttributes,
      ),
  };
}
