import {
  type ProviderInstanceId,
  type ServerConfigStreamProviderStatusesEvent,
  type ServerProviderUpdateInput,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import type * as ProviderRegistry from "../provider/Services/ProviderRegistry.ts";
import type * as ProviderMaintenanceRunner from "../provider/providerMaintenanceRunner.ts";
import type { RpcHandlerObservers } from "./handlers.ts";

export const PROVIDER_STATUS_DEBOUNCE_MS = 200;

export const PROVIDER_RPC_METHODS = [
  WS_METHODS.serverRefreshProviders,
  WS_METHODS.serverUpdateProvider,
] as const;

export function makeProviderStatusUpdates(
  providerRegistry: Pick<ProviderRegistry.ProviderRegistry["Service"], "streamChanges">,
): Stream.Stream<ServerConfigStreamProviderStatusesEvent> {
  return providerRegistry.streamChanges.pipe(
    Stream.map((providers) => ({
      version: 1 as const,
      type: "providerStatuses" as const,
      payload: { providers },
    })),
    Stream.debounce(Duration.millis(PROVIDER_STATUS_DEBOUNCE_MS)),
  );
}

export function makeProviderRpcHandlers(
  services: {
    readonly providerRegistry: Pick<
      ProviderRegistry.ProviderRegistry["Service"],
      "refresh" | "refreshInstance"
    >;
    readonly providerMaintenanceRunner: Pick<
      ProviderMaintenanceRunner.ProviderMaintenanceRunner["Service"],
      "updateProvider"
    >;
  },
  { observeEffect }: Pick<RpcHandlerObservers, "observeEffect">,
) {
  const traceAttributes = { "rpc.aggregate": "server" } as const;
  const { providerMaintenanceRunner, providerRegistry } = services;

  return {
    [WS_METHODS.serverRefreshProviders]: (input: {
      readonly instanceId?: ProviderInstanceId | undefined;
    }) =>
      observeEffect(
        WS_METHODS.serverRefreshProviders,
        (input.instanceId !== undefined
          ? providerRegistry.refreshInstance(input.instanceId)
          : providerRegistry.refresh()
        ).pipe(Effect.map((providers) => ({ providers }))),
        traceAttributes,
      ),
    [WS_METHODS.serverUpdateProvider]: (input: ServerProviderUpdateInput) =>
      observeEffect(
        WS_METHODS.serverUpdateProvider,
        providerMaintenanceRunner.updateProvider(input),
        traceAttributes,
      ),
  };
}
