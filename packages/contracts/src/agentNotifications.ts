import * as Schema from "effect/Schema";

import { AuthSessionId, EnvironmentId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const DIRECT_AGENT_NOTIFICATION_BUNDLE_ID = "com.goncalloramos.t3code.mobile" as const;

export const AgentNotificationApsEnvironment = Schema.Literals(["sandbox", "production"]);
export type AgentNotificationApsEnvironment = typeof AgentNotificationApsEnvironment.Type;

export const AgentNotificationPreferences = Schema.Struct({
  notificationsEnabled: Schema.Boolean,
  notifyOnApproval: Schema.Boolean,
  notifyOnInput: Schema.Boolean,
  notifyOnCompletion: Schema.Boolean,
  notifyOnFailure: Schema.Boolean,
});
export type AgentNotificationPreferences = typeof AgentNotificationPreferences.Type;

export const AgentNotificationPushToken = TrimmedNonEmptyString.check(
  Schema.isPattern(/^(?:[0-9a-fA-F]{2}){8,256}$/),
);

export const AgentNotificationDeviceRegistration = Schema.Struct({
  label: TrimmedNonEmptyString.check(Schema.isMaxLength(120)),
  platform: Schema.Literal("ios"),
  pushToken: AgentNotificationPushToken,
  bundleId: Schema.Literal(DIRECT_AGENT_NOTIFICATION_BUNDLE_ID),
  apsEnvironment: AgentNotificationApsEnvironment,
  appVersion: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(64))),
  iosMajorVersion: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  preferences: AgentNotificationPreferences,
});
export type AgentNotificationDeviceRegistration = typeof AgentNotificationDeviceRegistration.Type;

export const AgentNotificationDeviceParams = Schema.Struct({
  deviceId: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
});
export type AgentNotificationDeviceParams = typeof AgentNotificationDeviceParams.Type;

export const AgentNotificationRegistrationStatus = Schema.Struct({
  deviceId: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  platform: Schema.Literal("ios"),
  bundleId: Schema.Literal(DIRECT_AGENT_NOTIFICATION_BUNDLE_ID),
  apsEnvironment: AgentNotificationApsEnvironment,
  appVersion: Schema.NullOr(Schema.String),
  iosMajorVersion: Schema.Int,
  preferences: AgentNotificationPreferences,
  updatedAt: Schema.String,
  disabledAt: Schema.NullOr(Schema.String),
  failureReason: Schema.NullOr(Schema.String),
});
export type AgentNotificationRegistrationStatus = typeof AgentNotificationRegistrationStatus.Type;

export const AgentNotificationLastDeliveryStatus = Schema.Struct({
  deviceId: TrimmedNonEmptyString,
  threadId: Schema.NullOr(ThreadId),
  phase: Schema.Literals([
    "waiting_for_approval",
    "waiting_for_input",
    "completed",
    "failed",
    "test",
  ]),
  outcome: Schema.Literals(["pending", "delivered", "failed"]),
  attemptedAt: Schema.NullOr(Schema.String),
  apnsStatus: Schema.NullOr(Schema.Number),
  reason: Schema.NullOr(Schema.String),
});
export type AgentNotificationLastDeliveryStatus = typeof AgentNotificationLastDeliveryStatus.Type;

export const AgentNotificationEnvironmentStatus = Schema.Struct({
  environmentId: EnvironmentId,
  supported: Schema.Boolean,
  credentialsConfigured: Schema.Boolean,
  hostedRelayActive: Schema.Boolean,
  callerRegistration: Schema.NullOr(AgentNotificationRegistrationStatus),
  activeDeviceCount: Schema.Int,
  sandboxDeviceCount: Schema.Int,
  productionDeviceCount: Schema.Int,
  lastDelivery: Schema.NullOr(AgentNotificationLastDeliveryStatus),
});
export type AgentNotificationEnvironmentStatus = typeof AgentNotificationEnvironmentStatus.Type;

export const AgentNotificationRegistrationResult = Schema.Struct({
  registered: Schema.Boolean,
  registration: AgentNotificationRegistrationStatus,
});
export type AgentNotificationRegistrationResult = typeof AgentNotificationRegistrationResult.Type;

export const AgentNotificationUnregisterResult = Schema.Struct({
  removed: Schema.Boolean,
});
export type AgentNotificationUnregisterResult = typeof AgentNotificationUnregisterResult.Type;

export const AgentNotificationTestResult = Schema.Struct({
  queued: Schema.Boolean,
});
export type AgentNotificationTestResult = typeof AgentNotificationTestResult.Type;

export const AgentNotificationPhase = Schema.Literals([
  "waiting_for_approval",
  "waiting_for_input",
  "completed",
  "failed",
]);
export type AgentNotificationPhase = typeof AgentNotificationPhase.Type;

export const AgentNotificationPersistedPayload = Schema.Struct({
  title: TrimmedNonEmptyString,
  body: TrimmedNonEmptyString,
  environmentId: EnvironmentId,
  threadId: ThreadId,
  deepLink: TrimmedNonEmptyString,
  phase: AgentNotificationPhase,
  updatedAt: TrimmedNonEmptyString,
});
export type AgentNotificationPersistedPayload = typeof AgentNotificationPersistedPayload.Type;

// Used only by server persistence; exported here so database projections remain schema-backed.
export const AgentNotificationOwnedDevice = Schema.Struct({
  deviceId: TrimmedNonEmptyString,
  authSessionId: AuthSessionId,
  pushToken: AgentNotificationPushToken,
  registration: AgentNotificationRegistrationStatus,
});
export type AgentNotificationOwnedDevice = typeof AgentNotificationOwnedDevice.Type;
