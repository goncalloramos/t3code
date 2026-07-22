import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE agent_notification_devices (
      device_id TEXT PRIMARY KEY,
      auth_session_id TEXT NOT NULL REFERENCES auth_sessions(session_id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      platform TEXT NOT NULL,
      push_token TEXT NOT NULL,
      bundle_id TEXT NOT NULL,
      aps_environment TEXT NOT NULL,
      app_version TEXT,
      ios_major_version INTEGER NOT NULL,
      preferences_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      disabled_at TEXT,
      failure_reason TEXT
    )
  `;
  yield* sql`
    CREATE INDEX idx_agent_notification_devices_active
    ON agent_notification_devices(disabled_at, auth_session_id, aps_environment)
  `;

  yield* sql`
    CREATE TABLE agent_notification_thread_state (
      device_id TEXT NOT NULL REFERENCES agent_notification_devices(device_id) ON DELETE CASCADE,
      thread_id TEXT NOT NULL,
      phase TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(device_id, thread_id)
    )
  `;

  yield* sql`
    CREATE TABLE agent_notification_jobs (
      transition_id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL REFERENCES agent_notification_devices(device_id) ON DELETE CASCADE,
      thread_id TEXT,
      phase TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      attempted_at TEXT,
      delivered_at TEXT,
      failed_at TEXT,
      apns_status INTEGER,
      apns_reason TEXT
    )
  `;
  yield* sql`
    CREATE INDEX idx_agent_notification_jobs_pending
    ON agent_notification_jobs(delivered_at, failed_at, next_attempt_at, created_at)
  `;
});
