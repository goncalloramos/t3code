// @effect-diagnostics anyUnknownInErrorContext:off globalDateInEffect:off preferSchemaOverJson:off - SQLite is the trust boundary; rows are projected into schema-validated HTTP responses and persisted JSON contains only the declared notification DTOs.
import {
  type AgentNotificationDeviceRegistration,
  type AgentNotificationEnvironmentStatus,
  type AgentNotificationLastDeliveryStatus,
  type AgentNotificationPersistedPayload,
  type AgentNotificationPhase,
  type AgentNotificationRegistrationStatus,
  type AuthSessionId,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";

interface DeviceRow {
  readonly deviceId: string;
  readonly authSessionId: string;
  readonly label: string;
  readonly platform: "ios";
  readonly pushToken: string;
  readonly bundleId: "com.goncalloramos.t3code.mobile";
  readonly apsEnvironment: "sandbox" | "production";
  readonly appVersion: string | null;
  readonly iosMajorVersion: number;
  readonly preferencesJson: string;
  readonly updatedAt: string;
  readonly disabledAt: string | null;
  readonly failureReason: string | null;
}

interface ThreadStateRow {
  readonly phase: string | null;
  readonly updatedAt: string;
}

export interface AgentNotificationPendingJob {
  readonly transitionId: string;
  readonly deviceId: string;
  readonly authSessionId: string;
  readonly pushToken: string;
  readonly apsEnvironment: "sandbox" | "production";
  readonly threadId: string | null;
  readonly phase: AgentNotificationPhase | "test";
  readonly payloadJson: string;
  readonly attemptCount: number;
  readonly payload: AgentNotificationPersistedPayload;
}

const COMPLETION_SOURCE_PHASES = new Set(["running", "waiting_for_approval", "waiting_for_input"]);
const FAILURE_SOURCE_PHASES = new Set([
  "starting",
  "running",
  "waiting_for_approval",
  "waiting_for_input",
]);

const safeReason = (reason: string | null | undefined): string | null => {
  const normalized =
    reason
      ?.replace(/[\r\n\t]/g, " ")
      .trim()
      .slice(0, 120) ?? "";
  return normalized || null;
};

const parsePreferences = (json: string): AgentNotificationDeviceRegistration["preferences"] => {
  const fallback = {
    notificationsEnabled: false,
    notifyOnApproval: true,
    notifyOnInput: true,
    notifyOnCompletion: true,
    notifyOnFailure: true,
  };
  try {
    const value = JSON.parse(json) as Partial<typeof fallback>;
    return {
      notificationsEnabled: value.notificationsEnabled === true,
      notifyOnApproval: value.notifyOnApproval !== false,
      notifyOnInput: value.notifyOnInput !== false,
      notifyOnCompletion: value.notifyOnCompletion !== false,
      notifyOnFailure: value.notifyOnFailure !== false,
    };
  } catch {
    return fallback;
  }
};

const toRegistrationStatus = (row: DeviceRow): AgentNotificationRegistrationStatus => ({
  deviceId: row.deviceId,
  label: row.label,
  platform: "ios",
  bundleId: row.bundleId,
  apsEnvironment: row.apsEnvironment,
  appVersion: row.appVersion,
  iosMajorVersion: row.iosMajorVersion,
  preferences: parsePreferences(row.preferencesJson),
  updatedAt: row.updatedAt,
  disabledAt: row.disabledAt,
  failureReason: row.failureReason,
});

function preferenceAllows(
  preferences: AgentNotificationDeviceRegistration["preferences"],
  phase: AgentNotificationPhase,
): boolean {
  if (!preferences.notificationsEnabled) return false;
  switch (phase) {
    case "waiting_for_approval":
      return preferences.notifyOnApproval;
    case "waiting_for_input":
      return preferences.notifyOnInput;
    case "completed":
      return preferences.notifyOnCompletion;
    case "failed":
      return preferences.notifyOnFailure;
  }
}

function isGenuineTransition(input: {
  readonly previousPhase: string | null;
  readonly phase: AgentNotificationPhase;
  readonly updatedAt: string;
  readonly nowMs: number;
}): boolean {
  if (input.previousPhase === input.phase) return false;
  if (input.phase === "waiting_for_approval" || input.phase === "waiting_for_input") return true;
  const updatedAtMs = Date.parse(input.updatedAt);
  const sourcePhases = input.phase === "failed" ? FAILURE_SOURCE_PHASES : COMPLETION_SOURCE_PHASES;
  return (
    sourcePhases.has(input.previousPhase ?? "") &&
    Number.isFinite(updatedAtMs) &&
    input.nowMs - updatedAtMs <= 2 * 60_000
  );
}

export class AgentNotificationRepository extends Context.Service<
  AgentNotificationRepository,
  {
    readonly status: (input: {
      readonly sessionId: AuthSessionId;
      readonly environmentId: EnvironmentId;
      readonly supported: boolean;
      readonly credentialsConfigured: boolean;
      readonly hostedRelayActive: boolean;
    }) => Effect.Effect<AgentNotificationEnvironmentStatus, unknown>;
    readonly upsertDevice: (input: {
      readonly deviceId: string;
      readonly sessionId: AuthSessionId;
      readonly registration: AgentNotificationDeviceRegistration;
    }) => Effect.Effect<AgentNotificationRegistrationStatus, unknown>;
    readonly removeDevice: (input: {
      readonly deviceId: string;
      readonly sessionId: AuthSessionId;
    }) => Effect.Effect<boolean, unknown>;
    readonly enqueueTest: (input: {
      readonly deviceId: string;
      readonly sessionId: AuthSessionId;
      readonly environmentId: EnvironmentId;
      readonly now: string;
    }) => Effect.Effect<boolean, unknown>;
    readonly project: (input: {
      readonly threadId: ThreadId;
      readonly phase: string | null;
      readonly updatedAt: string;
      readonly payload: AgentNotificationPersistedPayload | null;
      readonly now: string;
    }) => Effect.Effect<number, unknown>;
    readonly pendingJobs: (input: {
      readonly now: string;
      readonly limit: number;
    }) => Effect.Effect<ReadonlyArray<AgentNotificationPendingJob>, unknown>;
    readonly markAttempt: (input: {
      readonly transitionId: string;
      readonly attemptedAt: string;
      readonly nextAttemptAt: string;
      readonly status: number | null;
      readonly reason: string | null;
    }) => Effect.Effect<void, unknown>;
    readonly markDelivered: (input: {
      readonly transitionId: string;
      readonly deliveredAt: string;
      readonly status: number;
    }) => Effect.Effect<void, unknown>;
    readonly markFailed: (input: {
      readonly transitionId: string;
      readonly failedAt: string;
      readonly status: number | null;
      readonly reason: string | null;
    }) => Effect.Effect<void, unknown>;
    readonly disableDevice: (input: {
      readonly deviceId: string;
      readonly disabledAt: string;
      readonly reason: string;
    }) => Effect.Effect<void, unknown>;
  }
>()("t3/persistence/AgentNotifications/AgentNotificationRepository") {}

const selectDeviceColumns = `
  device_id AS "deviceId", auth_session_id AS "authSessionId", label, platform,
  push_token AS "pushToken", bundle_id AS "bundleId", aps_environment AS "apsEnvironment",
  app_version AS "appVersion", ios_major_version AS "iosMajorVersion",
  preferences_json AS "preferencesJson", updated_at AS "updatedAt",
  disabled_at AS "disabledAt", failure_reason AS "failureReason"
`;

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const findOwnedDevice = (deviceId: string, sessionId: AuthSessionId) =>
    sql
      .unsafe<DeviceRow>(
        `SELECT ${selectDeviceColumns} FROM agent_notification_devices WHERE device_id = ? AND auth_session_id = ?`,
        [deviceId, sessionId],
      )
      .pipe(Effect.map((rows) => Option.fromUndefinedOr(rows[0])));

  const status: AgentNotificationRepository["Service"]["status"] = Effect.fn(
    "AgentNotificationRepository.status",
  )(function* (input) {
    const now = new Date().toISOString();
    const [callerRows, counts, lastRows] = yield* Effect.all([
      sql.unsafe<DeviceRow>(
        `SELECT ${selectDeviceColumns} FROM agent_notification_devices WHERE auth_session_id = ? ORDER BY updated_at DESC LIMIT 1`,
        [input.sessionId],
      ),
      sql<{ readonly total: number; readonly sandbox: number; readonly production: number }>`
        SELECT COUNT(*) AS total,
          SUM(CASE WHEN d.aps_environment = 'sandbox' THEN 1 ELSE 0 END) AS sandbox,
          SUM(CASE WHEN d.aps_environment = 'production' THEN 1 ELSE 0 END) AS production
        FROM agent_notification_devices d
        JOIN auth_sessions s ON s.session_id = d.auth_session_id
        WHERE d.disabled_at IS NULL AND s.revoked_at IS NULL AND s.expires_at > ${now}
      `,
      sql<{
        readonly deviceId: string;
        readonly threadId: string | null;
        readonly phase: AgentNotificationLastDeliveryStatus["phase"];
        readonly attemptedAt: string | null;
        readonly deliveredAt: string | null;
        readonly failedAt: string | null;
        readonly apnsStatus: number | null;
        readonly apnsReason: string | null;
      }>`
        SELECT device_id AS "deviceId", thread_id AS "threadId", phase,
          attempted_at AS "attemptedAt", delivered_at AS "deliveredAt", failed_at AS "failedAt",
          apns_status AS "apnsStatus", apns_reason AS "apnsReason"
        FROM agent_notification_jobs
        ORDER BY COALESCE(attempted_at, created_at) DESC LIMIT 1
      `,
    ]);
    const count = counts[0] ?? { total: 0, sandbox: 0, production: 0 };
    const last = lastRows[0];
    return {
      environmentId: input.environmentId,
      supported: input.supported,
      credentialsConfigured: input.credentialsConfigured,
      hostedRelayActive: input.hostedRelayActive,
      callerRegistration: callerRows[0] ? toRegistrationStatus(callerRows[0]) : null,
      activeDeviceCount: Number(count.total ?? 0),
      sandboxDeviceCount: Number(count.sandbox ?? 0),
      productionDeviceCount: Number(count.production ?? 0),
      lastDelivery: last
        ? {
            deviceId: last.deviceId,
            threadId: last.threadId as ThreadId | null,
            phase: last.phase,
            outcome: last.deliveredAt ? "delivered" : last.failedAt ? "failed" : "pending",
            attemptedAt: last.attemptedAt,
            apnsStatus: last.apnsStatus,
            reason: safeReason(last.apnsReason),
          }
        : null,
    };
  });

  const upsertDevice: AgentNotificationRepository["Service"]["upsertDevice"] = Effect.fn(
    "AgentNotificationRepository.upsertDevice",
  )(function* (input) {
    const now = new Date().toISOString();
    yield* sql`
      INSERT INTO agent_notification_devices (
        device_id, auth_session_id, label, platform, push_token, bundle_id, aps_environment,
        app_version, ios_major_version, preferences_json, created_at, updated_at,
        disabled_at, failure_reason
      ) VALUES (
        ${input.deviceId}, ${input.sessionId}, ${input.registration.label}, ${input.registration.platform},
        ${input.registration.pushToken}, ${input.registration.bundleId}, ${input.registration.apsEnvironment},
        ${input.registration.appVersion ?? null}, ${input.registration.iosMajorVersion},
        ${JSON.stringify(input.registration.preferences)}, ${now}, ${now}, NULL, NULL
      )
      ON CONFLICT(device_id) DO UPDATE SET
        auth_session_id = excluded.auth_session_id, label = excluded.label,
        platform = excluded.platform, push_token = excluded.push_token,
        bundle_id = excluded.bundle_id, aps_environment = excluded.aps_environment,
        app_version = excluded.app_version, ios_major_version = excluded.ios_major_version,
        preferences_json = excluded.preferences_json, updated_at = excluded.updated_at,
        disabled_at = NULL, failure_reason = NULL
    `;
    const row = yield* findOwnedDevice(input.deviceId, input.sessionId);
    return toRegistrationStatus(Option.getOrThrow(row));
  });

  const removeDevice: AgentNotificationRepository["Service"]["removeDevice"] = Effect.fn(
    "AgentNotificationRepository.removeDevice",
  )(function* (input) {
    const result = yield* sql<{ readonly deviceId: string }>`
      DELETE FROM agent_notification_devices
      WHERE device_id = ${input.deviceId} AND auth_session_id = ${input.sessionId}
      RETURNING device_id AS "deviceId"
    `;
    return result.length > 0;
  });

  const enqueueTest: AgentNotificationRepository["Service"]["enqueueTest"] = Effect.fn(
    "AgentNotificationRepository.enqueueTest",
  )(function* (input) {
    const devices =
      input.deviceId === "all"
        ? yield* sql.unsafe<DeviceRow>(
            `SELECT ${selectDeviceColumns} FROM agent_notification_devices d
             JOIN auth_sessions s ON s.session_id = d.auth_session_id
             WHERE d.disabled_at IS NULL AND s.revoked_at IS NULL AND s.expires_at > ?`,
            [input.now],
          )
        : Option.toArray(yield* findOwnedDevice(input.deviceId, input.sessionId)).filter(
            (device) => device.disabledAt === null,
          );
    if (devices.length === 0) return false;
    const payload: AgentNotificationPersistedPayload = {
      title: "T3 Code",
      body: "Direct notifications from this Mac are working.",
      environmentId: input.environmentId,
      threadId: "test" as ThreadId,
      deepLink: "/",
      phase: "completed",
      updatedAt: input.now,
    };
    for (const device of devices) {
      const transitionId = `test:${device.deviceId}:${input.now}`;
      yield* sql`
        INSERT OR IGNORE INTO agent_notification_jobs (
          transition_id, device_id, thread_id, phase, payload_json, next_attempt_at, created_at
        ) VALUES (${transitionId}, ${device.deviceId}, NULL, 'test', ${JSON.stringify(payload)}, ${input.now}, ${input.now})
      `;
    }
    return true;
  });

  const project: AgentNotificationRepository["Service"]["project"] = Effect.fn(
    "AgentNotificationRepository.project",
  )(function* (input) {
    const devices = yield* sql.unsafe<DeviceRow>(
      `SELECT ${selectDeviceColumns} FROM agent_notification_devices d
       JOIN auth_sessions s ON s.session_id = d.auth_session_id
       WHERE d.disabled_at IS NULL AND s.revoked_at IS NULL AND s.expires_at > ?`,
      [input.now],
    );
    let jobs = 0;
    for (const device of devices) {
      jobs += yield* sql.withTransaction(
        Effect.gen(function* () {
          const stateRows = yield* sql<ThreadStateRow>`
            SELECT phase, updated_at AS "updatedAt"
            FROM agent_notification_thread_state
            WHERE device_id = ${device.deviceId} AND thread_id = ${input.threadId}
          `;
          const previous = stateRows[0];
          yield* sql`
            INSERT INTO agent_notification_thread_state (device_id, thread_id, phase, updated_at)
            VALUES (${device.deviceId}, ${input.threadId}, ${input.phase}, ${input.updatedAt})
            ON CONFLICT(device_id, thread_id) DO UPDATE SET
              phase = excluded.phase, updated_at = excluded.updated_at
          `;
          if (!previous || input.phase === null || input.payload === null) return 0;
          if (
            !isGenuineTransition({
              previousPhase: previous.phase,
              phase: input.phase as AgentNotificationPhase,
              updatedAt: input.updatedAt,
              nowMs: Date.parse(input.now),
            }) ||
            !preferenceAllows(
              parsePreferences(device.preferencesJson),
              input.phase as AgentNotificationPhase,
            )
          ) {
            return 0;
          }
          const transitionId = `${device.deviceId}:${input.threadId}:${input.phase}:${input.updatedAt}`;
          yield* sql`
            INSERT OR IGNORE INTO agent_notification_jobs (
              transition_id, device_id, thread_id, phase, payload_json, next_attempt_at, created_at
            ) VALUES (
              ${transitionId}, ${device.deviceId}, ${input.threadId}, ${input.phase},
              ${JSON.stringify(input.payload)}, ${input.now}, ${input.now}
            )
          `;
          return 1;
        }),
      );
    }
    return jobs;
  });

  const pendingJobs: AgentNotificationRepository["Service"]["pendingJobs"] = Effect.fn(
    "AgentNotificationRepository.pendingJobs",
  )(function* (input) {
    const rows = yield* sql.unsafe<Omit<AgentNotificationPendingJob, "payload">>(
      `SELECT j.transition_id AS "transitionId", j.device_id AS "deviceId",
        d.auth_session_id AS "authSessionId", d.push_token AS "pushToken",
        d.aps_environment AS "apsEnvironment", j.thread_id AS "threadId", j.phase,
        j.payload_json AS "payloadJson", j.attempt_count AS "attemptCount"
       FROM agent_notification_jobs j
       JOIN agent_notification_devices d ON d.device_id = j.device_id
       JOIN auth_sessions s ON s.session_id = d.auth_session_id
       WHERE j.delivered_at IS NULL AND j.failed_at IS NULL AND j.next_attempt_at <= ?
         AND d.disabled_at IS NULL AND s.revoked_at IS NULL AND s.expires_at > ?
       ORDER BY j.created_at LIMIT ?`,
      [input.now, input.now, input.limit],
    );
    return rows.flatMap((row) => {
      try {
        return [
          { ...row, payload: JSON.parse(row.payloadJson) as AgentNotificationPersistedPayload },
        ];
      } catch {
        return [];
      }
    });
  });

  const markAttempt: AgentNotificationRepository["Service"]["markAttempt"] = Effect.fn(
    "AgentNotificationRepository.markAttempt",
  )(function* (input) {
    yield* sql`
      UPDATE agent_notification_jobs SET attempt_count = attempt_count + 1,
        attempted_at = ${input.attemptedAt}, next_attempt_at = ${input.nextAttemptAt},
        apns_status = ${input.status}, apns_reason = ${safeReason(input.reason)}
      WHERE transition_id = ${input.transitionId}
    `;
  });
  const markDelivered: AgentNotificationRepository["Service"]["markDelivered"] = Effect.fn(
    "AgentNotificationRepository.markDelivered",
  )(function* (input) {
    yield* sql`
      UPDATE agent_notification_jobs SET delivered_at = ${input.deliveredAt},
        apns_status = ${input.status}, apns_reason = NULL
      WHERE transition_id = ${input.transitionId}
    `;
  });
  const markFailed: AgentNotificationRepository["Service"]["markFailed"] = Effect.fn(
    "AgentNotificationRepository.markFailed",
  )(function* (input) {
    yield* sql`
      UPDATE agent_notification_jobs SET failed_at = ${input.failedAt},
        apns_status = ${input.status}, apns_reason = ${safeReason(input.reason)}
      WHERE transition_id = ${input.transitionId}
    `;
  });
  const disableDevice: AgentNotificationRepository["Service"]["disableDevice"] = Effect.fn(
    "AgentNotificationRepository.disableDevice",
  )(function* (input) {
    yield* sql`
      UPDATE agent_notification_devices SET disabled_at = ${input.disabledAt},
        failure_reason = ${safeReason(input.reason)} WHERE device_id = ${input.deviceId}
    `;
  });

  return AgentNotificationRepository.of({
    status,
    upsertDevice,
    removeDevice,
    enqueueTest,
    project,
    pendingJobs,
    markAttempt,
    markDelivered,
    markFailed,
    disableDevice,
  });
});

export const layer = Layer.effect(AgentNotificationRepository, make);
