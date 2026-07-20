import {
  AuthAccessStreamError,
  type AuthAccessStreamEvent,
  type AuthSessionId,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import type * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import type * as PairingGrantStore from "../auth/PairingGrantStore.ts";
import type * as SessionStore from "../auth/SessionStore.ts";
import type { RpcHandlerObservers } from "./handlers.ts";

type AuthAccessChange =
  | PairingGrantStore.BootstrapCredentialChange
  | SessionStore.SessionCredentialChange;

export function toAuthAccessStreamEvent(
  change: AuthAccessChange,
  revision: number,
  currentSessionId: AuthSessionId,
): AuthAccessStreamEvent {
  switch (change.type) {
    case "pairingLinkUpserted":
      return {
        version: 1,
        revision,
        type: "pairingLinkUpserted",
        payload: change.pairingLink,
      };
    case "pairingLinkRemoved":
      return {
        version: 1,
        revision,
        type: "pairingLinkRemoved",
        payload: { id: change.id },
      };
    case "clientUpserted":
      return {
        version: 1,
        revision,
        type: "clientUpserted",
        payload: {
          ...change.clientSession,
          current: change.clientSession.sessionId === currentSessionId,
        },
      };
    case "clientRemoved":
      return {
        version: 1,
        revision,
        type: "clientRemoved",
        payload: { sessionId: change.sessionId },
      };
  }
}

export const ACCESS_RPC_METHODS = [WS_METHODS.subscribeAuthAccess] as const;

export function makeAccessRpcHandlers(
  services: {
    readonly currentSessionId: AuthSessionId;
    readonly serverAuth: Pick<
      EnvironmentAuth.EnvironmentAuth["Service"],
      "listPairingLinks" | "listClientSessions"
    >;
    readonly bootstrapCredentials: Pick<
      PairingGrantStore.PairingGrantStore["Service"],
      "streamChanges"
    >;
    readonly sessions: Pick<SessionStore.SessionStore["Service"], "streamChanges">;
  },
  { observeStreamEffect }: Pick<RpcHandlerObservers, "observeStreamEffect">,
) {
  const traceAttributes = { "rpc.aggregate": "auth" } as const;
  const { bootstrapCredentials, currentSessionId, serverAuth, sessions } = services;

  const loadSnapshot = () =>
    Effect.all({
      pairingLinks: serverAuth.listPairingLinks(),
      clientSessions: serverAuth.listClientSessions(currentSessionId),
    }).pipe(
      Effect.mapError(
        (error) =>
          new AuthAccessStreamError({
            message: error.message,
          }),
      ),
    );

  return {
    [WS_METHODS.subscribeAuthAccess]: (_input: {}) =>
      observeStreamEffect(
        WS_METHODS.subscribeAuthAccess,
        Effect.gen(function* () {
          const initialSnapshot = yield* loadSnapshot();
          const revisionRef = yield* Ref.make(1);
          const accessChanges: Stream.Stream<AuthAccessChange> = Stream.merge(
            bootstrapCredentials.streamChanges,
            sessions.streamChanges,
          );
          const liveEvents = accessChanges.pipe(
            Stream.mapEffect((change) =>
              Ref.updateAndGet(revisionRef, (revision) => revision + 1).pipe(
                Effect.map((revision) =>
                  toAuthAccessStreamEvent(change, revision, currentSessionId),
                ),
              ),
            ),
          );

          return Stream.concat(
            Stream.make({
              version: 1 as const,
              revision: 1,
              type: "snapshot" as const,
              payload: initialSnapshot,
            }),
            liveEvents,
          );
        }),
        traceAttributes,
      ),
  };
}
