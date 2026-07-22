// @effect-diagnostics anyUnknownInErrorContext:off - Persistence failures are converted to the API's sanitized internal-error response.
import {
  AuthNotificationsManageScope,
  AuthAccessWriteScope,
  EnvironmentHttpApi,
  EnvironmentHttpBadRequestError,
  EnvironmentHttpConflictError,
  EnvironmentInternalError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { annotateEnvironmentRequest, requireEnvironmentScope } from "../auth/http.ts";
import { layerConfig as SqlitePersistenceLayer } from "../persistence/Layers/Sqlite.ts";
import * as AgentNotifications from "../persistence/AgentNotifications.ts";
import * as DirectAgentNotifications from "./DirectAgentNotifications.ts";

const mapFailure = (cause: unknown) => {
  const message = cause instanceof Error ? cause.message : "Direct notification operation failed.";
  return message.includes("Hosted agent activity") || message.includes("credentials")
    ? new EnvironmentHttpConflictError({ message })
    : new EnvironmentInternalError({
        code: "internal_error",
        reason: "agent_notifications_failed",
        traceId: "unavailable",
      });
};

const handlersLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "agentNotifications",
  Effect.fnUntraced(function* (handlers) {
    const notifications = yield* DirectAgentNotifications.DirectAgentNotifications;

    return handlers
      .handle(
        "status",
        Effect.fn("environment.agentNotifications.status")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          const session = yield* requireEnvironmentScope(AuthNotificationsManageScope);
          return yield* notifications.status(session.sessionId).pipe(Effect.mapError(mapFailure));
        }),
      )
      .handle(
        "registerDevice",
        Effect.fn("environment.agentNotifications.registerDevice")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          const session = yield* requireEnvironmentScope(AuthNotificationsManageScope);
          const status = yield* notifications
            .status(session.sessionId)
            .pipe(Effect.mapError(mapFailure));
          if (!status.supported) {
            return yield* new EnvironmentHttpBadRequestError({
              message: "Direct iOS notifications are not supported by this environment.",
            });
          }
          if (status.hostedRelayActive) {
            return yield* new EnvironmentHttpConflictError({
              message: "Hosted agent activity publishing is active.",
            });
          }
          if (!status.credentialsConfigured) {
            return yield* new EnvironmentHttpConflictError({
              message: "APNs credentials are not configured on this Mac.",
            });
          }
          const registration = yield* notifications
            .register({
              sessionId: session.sessionId,
              deviceId: args.params.deviceId,
              registration: args.payload,
            })
            .pipe(Effect.mapError(mapFailure));
          return { registered: true, registration };
        }),
      )
      .handle(
        "unregisterDevice",
        Effect.fn("environment.agentNotifications.unregisterDevice")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          const session = yield* requireEnvironmentScope(AuthNotificationsManageScope);
          const removed = yield* notifications
            .unregister({ sessionId: session.sessionId, deviceId: args.params.deviceId })
            .pipe(Effect.mapError(mapFailure));
          return { removed };
        }),
      )
      .handle(
        "testDevice",
        Effect.fn("environment.agentNotifications.testDevice")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          const session = yield* requireEnvironmentScope(AuthNotificationsManageScope);
          if (args.params.deviceId === "all" && !session.scopes.has(AuthAccessWriteScope)) {
            yield* requireEnvironmentScope(AuthAccessWriteScope);
          }
          const queued = yield* notifications
            .test({ sessionId: session.sessionId, deviceId: args.params.deviceId })
            .pipe(Effect.mapError(mapFailure));
          return { queued };
        }),
      );
  }),
);

export const agentNotificationsHttpApiLayer = handlersLayer.pipe(
  Layer.provide(
    DirectAgentNotifications.layer.pipe(
      Layer.provide(AgentNotifications.layer.pipe(Layer.provide(SqlitePersistenceLayer))),
    ),
  ),
);
