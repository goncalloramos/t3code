import type { AgentNotificationDeviceRegistration, EnvironmentId } from "@t3tools/contracts";
import { fetchRemoteEnvironmentDescriptor } from "@t3tools/client-runtime/environment";
import {
  executeEnvironmentHttpRequest,
  makeEnvironmentHttpApiClient,
  remoteHttpClientLayer,
} from "@t3tools/client-runtime/rpc";
import { environmentEndpointUrl } from "@t3tools/client-runtime/environment";
import * as Effect from "effect/Effect";

import type { SavedRemoteConnection } from "../../lib/connection";
import { isRelayManagedConnection } from "../../lib/connection";

const REQUEST_TIMEOUT_MS = 10_000;

export type DirectNotificationRegistrationState =
  | "checking"
  | "unsupported"
  | "unreachable"
  | "credentials-missing"
  | "hosted-relay-active"
  | "not-registered"
  | "registered"
  | "delivery-failed";

export interface DirectNotificationEnvironmentState {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly state: DirectNotificationRegistrationState;
  readonly detail: string | null;
}

let snapshot: ReadonlyArray<DirectNotificationEnvironmentState> = [];
const listeners = new Set<() => void>();

const publish = (next: DirectNotificationEnvironmentState): void => {
  const byId = new Map(snapshot.map((item) => [item.environmentId, item]));
  byId.set(next.environmentId, next);
  snapshot = [...byId.values()].sort((left, right) => left.label.localeCompare(right.label));
  for (const listener of listeners) listener();
};

export const getDirectNotificationEnvironmentStates = () => snapshot;

export const subscribeDirectNotificationEnvironmentStates = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const removeDirectNotificationEnvironmentState = (environmentId: EnvironmentId): void => {
  const next = snapshot.filter((item) => item.environmentId !== environmentId);
  if (next.length === snapshot.length) return;
  snapshot = next;
  for (const listener of listeners) listener();
};

const stateFor = (
  connection: SavedRemoteConnection,
  state: DirectNotificationRegistrationState,
  detail: string | null = null,
): DirectNotificationEnvironmentState => ({
  environmentId: connection.environmentId,
  label: connection.environmentLabel,
  state,
  detail,
});

export function synchronizeDirectNotificationRegistration(input: {
  readonly connection: SavedRemoteConnection;
  readonly deviceId: string;
  readonly registration: AgentNotificationDeviceRegistration;
}): Effect.Effect<boolean> {
  return Effect.gen(function* () {
    const { connection } = input;
    publish(stateFor(connection, "checking"));
    if (isRelayManagedConnection(connection)) {
      publish(stateFor(connection, "hosted-relay-active", "Managed by T3 Connect"));
      return false;
    }

    const descriptor = yield* fetchRemoteEnvironmentDescriptor({
      httpBaseUrl: connection.httpBaseUrl,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
    if (!descriptor.capabilities.directAgentNotifications) {
      publish(stateFor(connection, "unsupported", "Update T3 Code on this Mac"));
      return false;
    }
    if (!connection.bearerToken) {
      publish(stateFor(connection, "unreachable", "Reconnect this environment"));
      return false;
    }

    const client = yield* makeEnvironmentHttpApiClient(connection.httpBaseUrl);
    const headers = { authorization: `Bearer ${connection.bearerToken}` };
    const status = yield* executeEnvironmentHttpRequest(
      environmentEndpointUrl(connection.httpBaseUrl, "/api/agent-notifications/status"),
      REQUEST_TIMEOUT_MS,
      client.agentNotifications.status({ headers }),
    );
    if (status.hostedRelayActive) {
      publish(stateFor(connection, "hosted-relay-active", "Managed by T3 Connect"));
      return false;
    }
    if (!status.credentialsConfigured) {
      publish(stateFor(connection, "credentials-missing", "Configure APNs on this Mac"));
      return false;
    }

    if (!input.registration.preferences.notificationsEnabled) {
      yield* executeEnvironmentHttpRequest(
        environmentEndpointUrl(
          connection.httpBaseUrl,
          `/api/agent-notifications/devices/${encodeURIComponent(input.deviceId)}`,
        ),
        REQUEST_TIMEOUT_MS,
        client.agentNotifications.unregisterDevice({
          headers,
          params: { deviceId: input.deviceId },
        }),
      );
      publish(stateFor(connection, "not-registered", "Notifications disabled"));
      return false;
    }

    const registered = yield* executeEnvironmentHttpRequest(
      environmentEndpointUrl(
        connection.httpBaseUrl,
        `/api/agent-notifications/devices/${encodeURIComponent(input.deviceId)}`,
      ),
      REQUEST_TIMEOUT_MS,
      client.agentNotifications.registerDevice({
        headers,
        params: { deviceId: input.deviceId },
        payload: input.registration,
      }),
    );
    const deliveryFailure = registered.registration.failureReason;
    publish(
      stateFor(connection, deliveryFailure ? "delivery-failed" : "registered", deliveryFailure),
    );
    return !deliveryFailure;
  }).pipe(
    Effect.provide(remoteHttpClientLayer(globalThis.fetch)),
    Effect.catch(() =>
      Effect.sync(() => {
        publish(stateFor(input.connection, "unreachable", "Registration will retry automatically"));
        return false;
      }),
    ),
  );
}

export function __resetDirectNotificationRegistrationForTest(): void {
  snapshot = [];
  listeners.clear();
}
