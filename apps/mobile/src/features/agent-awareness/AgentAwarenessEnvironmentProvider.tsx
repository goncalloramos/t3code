import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import type { EnvironmentId } from "@t3tools/contracts";

import type { SavedRemoteConnection } from "../../lib/connection";
import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";
import {
  registerAgentAwarenessConnection,
  unregisterAgentAwarenessConnection,
} from "./remoteRegistration";

/**
 * Keeps direct-notification registration aligned with the environment catalog.
 * This lives above navigation so reconnects and foreground registration do not
 * depend on the Settings screen being mounted.
 */
export function AgentAwarenessEnvironmentProvider(props: { readonly children: ReactNode }) {
  const { savedConnectionsById } = useSavedRemoteConnections();
  const registeredConnections = useRef(new Map<EnvironmentId, SavedRemoteConnection>());

  useEffect(() => {
    const nextConnections = new Map(
      Object.values(savedConnectionsById).map((connection) => [
        connection.environmentId,
        connection,
      ]),
    );

    for (const environmentId of registeredConnections.current.keys()) {
      if (!nextConnections.has(environmentId)) {
        unregisterAgentAwarenessConnection(environmentId);
      }
    }
    for (const connection of nextConnections.values()) {
      registerAgentAwarenessConnection(connection);
    }
    registeredConnections.current = nextConnections;
  }, [savedConnectionsById]);

  useEffect(
    () => () => {
      for (const environmentId of registeredConnections.current.keys()) {
        unregisterAgentAwarenessConnection(environmentId);
      }
      registeredConnections.current.clear();
    },
    [],
  );

  return props.children;
}
