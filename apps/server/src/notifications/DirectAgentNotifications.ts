// @effect-diagnostics anyUnknownInErrorContext:off globalDateInEffect:off globalErrorInEffectFailure:off - SQL/APNs failures are sanitized at the authenticated HTTP and worker boundaries.
import type {
  AgentNotificationDeviceRegistration,
  AgentNotificationEnvironmentStatus,
  AgentNotificationPersistedPayload,
  AgentNotificationRegistrationStatus,
  AgentNotificationPhase,
  AuthSessionId,
  ThreadId,
} from "@t3tools/contracts";
import type { RelayAgentActivityState } from "@t3tools/contracts/relay";
import {
  isPermanentApnsTokenFailure,
  SafeApnsError,
  sendApnsAlert,
  shouldRetryApnsDelivery,
} from "@t3tools/shared/apns";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import type * as Scope from "effect/Scope";

import * as ServerConfig from "../config.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { PUBLISH_AGENT_ACTIVITY_SECRET } from "../cloud/config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as AgentNotifications from "../persistence/AgentNotifications.ts";
import type { AgentNotificationPendingJob } from "../persistence/AgentNotifications.ts";

const MAX_DELIVERY_ATTEMPTS = 5;
const DELIVERY_BATCH_SIZE = 8;
const DELIVERY_CONCURRENCY = 4;

const directPhase = (phase: string): AgentNotificationPhase | null => {
  switch (phase) {
    case "waiting_for_approval":
    case "waiting_for_input":
    case "completed":
    case "failed":
      return phase;
    default:
      return null;
  }
};

const notificationBody = (
  state: RelayAgentActivityState,
  phase: AgentNotificationPhase,
): string => {
  switch (phase) {
    case "waiting_for_approval":
      return `${state.projectTitle} · Approval required`;
    case "waiting_for_input":
      return `${state.projectTitle} · Waiting for your response`;
    case "completed":
      return `${state.projectTitle} · Finished`;
    case "failed":
      return `${state.projectTitle} · Failed`;
  }
};

export const makeDirectAgentNotificationPayload = (
  state: RelayAgentActivityState,
): AgentNotificationPersistedPayload | null => {
  const phase = directPhase(state.phase);
  if (phase === null) return null;
  return {
    title: state.threadTitle.trim() || state.headline,
    body: notificationBody(state, phase),
    environmentId: state.environmentId,
    threadId: state.threadId,
    deepLink: state.deepLink,
    phase,
    updatedAt: state.updatedAt,
  };
};

export class DirectAgentNotifications extends Context.Service<
  DirectAgentNotifications,
  {
    readonly supported: boolean;
    readonly hostedRelayActive: Effect.Effect<boolean>;
    readonly status: (
      sessionId: AuthSessionId,
    ) => Effect.Effect<AgentNotificationEnvironmentStatus, unknown>;
    readonly register: (input: {
      readonly sessionId: AuthSessionId;
      readonly deviceId: string;
      readonly registration: AgentNotificationDeviceRegistration;
    }) => Effect.Effect<AgentNotificationRegistrationStatus, unknown>;
    readonly unregister: (input: {
      readonly sessionId: AuthSessionId;
      readonly deviceId: string;
    }) => Effect.Effect<boolean, unknown>;
    readonly test: (input: {
      readonly sessionId: AuthSessionId;
      readonly deviceId: string;
    }) => Effect.Effect<boolean, unknown>;
    readonly projectThreadState: (input: {
      readonly threadId: ThreadId;
      readonly state: RelayAgentActivityState | null;
    }) => Effect.Effect<void>;
    readonly drain: Effect.Effect<void>;
    readonly start: Effect.Effect<void, never, Scope.Scope>;
  }
>()("t3/notifications/DirectAgentNotifications") {}

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const repository = yield* AgentNotifications.AgentNotificationRepository;
  const environmentId = yield* environment.getEnvironmentId;
  const descriptor = yield* environment.getDescriptor;
  const supported = descriptor.capabilities.directAgentNotifications;

  const hostedRelayActive = secrets.get(PUBLISH_AGENT_ACTIVITY_SECRET).pipe(
    Effect.map(
      (value) => Option.isSome(value) && new TextDecoder().decode(value.value).trim() === "true",
    ),
    Effect.orElseSucceed(() => false),
  );

  const status: DirectAgentNotifications["Service"]["status"] = (sessionId) =>
    Effect.gen(function* () {
      return yield* repository.status({
        sessionId,
        environmentId,
        supported,
        credentialsConfigured: config.apnsCredentials !== undefined,
        hostedRelayActive: yield* hostedRelayActive,
      });
    });

  const register: DirectAgentNotifications["Service"]["register"] = Effect.fn(
    "DirectAgentNotifications.register",
  )(function* (input) {
    if (!supported) return yield* Effect.fail(new Error("Direct notifications are unsupported."));
    if (yield* hostedRelayActive) {
      return yield* Effect.fail(new Error("Hosted agent activity publishing is active."));
    }
    if (!config.apnsCredentials) {
      return yield* Effect.fail(new Error("APNs credentials are not configured on this Mac."));
    }
    return yield* repository.upsertDevice(input);
  });

  const unregister: DirectAgentNotifications["Service"]["unregister"] = (input) =>
    repository.removeDevice(input);

  const drainJob = Effect.fn("DirectAgentNotifications.drainJob")(function* (
    job: AgentNotificationPendingJob,
  ) {
    const credentials = config.apnsCredentials;
    if (!credentials) return;
    const nowMs = yield* Clock.currentTimeMillis;
    const attemptedAt = new Date(nowMs).toISOString();
    const attempt = job.attemptCount + 1;
    const backoffMs = Math.min(60_000, 1_000 * 2 ** Math.max(0, attempt - 1));
    const nextAttemptAt = new Date(nowMs + backoffMs).toISOString();
    yield* repository.markAttempt({
      transitionId: job.transitionId,
      attemptedAt,
      nextAttemptAt,
      status: null,
      reason: null,
    });

    const result = yield* Effect.tryPromise({
      try: () =>
        sendApnsAlert({
          credentials,
          environment: job.apsEnvironment,
          token: job.pushToken,
          notification: job.payload,
          nowUnixSeconds: Math.floor(nowMs / 1_000),
        }),
      catch: (cause) =>
        cause instanceof SafeApnsError
          ? cause
          : new SafeApnsError({ reason: "transport_error", token: job.pushToken }),
    }).pipe(Effect.option);

    if (Option.isNone(result)) {
      if (attempt >= MAX_DELIVERY_ATTEMPTS) {
        yield* repository.markFailed({
          transitionId: job.transitionId,
          failedAt: attemptedAt,
          status: null,
          reason: "transport_error",
        });
      }
      return;
    }
    const delivery = result.value;
    if (delivery.ok) {
      yield* repository.markDelivered({
        transitionId: job.transitionId,
        deliveredAt: attemptedAt,
        status: delivery.status,
      });
      return;
    }
    if (isPermanentApnsTokenFailure(delivery.status, delivery.reason)) {
      yield* repository.disableDevice({
        deviceId: job.deviceId,
        disabledAt: attemptedAt,
        reason: delivery.reason ?? "invalid_device_token",
      });
      yield* repository.markFailed({
        transitionId: job.transitionId,
        failedAt: attemptedAt,
        status: delivery.status,
        reason: delivery.reason,
      });
      return;
    }
    if (shouldRetryApnsDelivery(delivery.status) && attempt < MAX_DELIVERY_ATTEMPTS) return;
    yield* repository.markFailed({
      transitionId: job.transitionId,
      failedAt: attemptedAt,
      status: delivery.status,
      reason: delivery.reason ?? "apns_rejected",
    });
  });

  const drain = Effect.gen(function* () {
    if (!config.apnsCredentials || (yield* hostedRelayActive)) return;
    const nowMs = yield* Clock.currentTimeMillis;
    const jobs = yield* repository.pendingJobs({
      now: new Date(nowMs).toISOString(),
      limit: DELIVERY_BATCH_SIZE,
    });
    yield* Effect.forEach(jobs, drainJob, {
      concurrency: DELIVERY_CONCURRENCY,
      discard: true,
    });
  }).pipe(
    Effect.catch((cause) => Effect.logWarning("direct APNs delivery drain failed", { cause })),
  );

  const test: DirectAgentNotifications["Service"]["test"] = Effect.fn(
    "DirectAgentNotifications.test",
  )(function* (input) {
    if (yield* hostedRelayActive) {
      return yield* Effect.fail(new Error("Hosted agent activity publishing is active."));
    }
    if (!config.apnsCredentials) {
      return yield* Effect.fail(new Error("APNs credentials are not configured on this Mac."));
    }
    const nowMs = yield* Clock.currentTimeMillis;
    return yield* repository.enqueueTest({
      ...input,
      environmentId,
      now: new Date(nowMs).toISOString(),
    });
  });

  const projectThreadState: DirectAgentNotifications["Service"]["projectThreadState"] = (input) =>
    Effect.gen(function* () {
      if (!supported || !config.apnsCredentials || (yield* hostedRelayActive)) return;
      const now = new Date(yield* Clock.currentTimeMillis).toISOString();
      const payload = input.state ? makeDirectAgentNotificationPayload(input.state) : null;
      yield* repository.project({
        threadId: input.threadId,
        phase: input.state?.phase ?? null,
        updatedAt: input.state?.updatedAt ?? now,
        payload,
        now,
      });
    }).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("direct notification projection failed", {
          threadId: input.threadId,
          cause,
        }),
      ),
    );

  const start = Effect.gen(function* () {
    yield* Effect.forkScoped(drain.pipe(Effect.repeat(Schedule.spaced(Duration.seconds(2)))));
  });

  return DirectAgentNotifications.of({
    supported,
    hostedRelayActive,
    status,
    register,
    unregister,
    test,
    projectThreadState,
    drain,
    start,
  });
});

export const layer = Layer.effect(DirectAgentNotifications, make);
