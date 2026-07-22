// @effect-diagnostics anyUnknownInErrorContext:off preferSchemaOverJson:off - The repository deliberately preserves SQLite's unknown error channel; fixtures also inspect persisted preference JSON directly.
import { assert, it } from "@effect/vitest";
import type { AuthSessionId, EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as AgentNotifications from "./AgentNotifications.ts";
import { SqlitePersistenceMemory } from "./Layers/Sqlite.ts";

const repositoryLayer = Layer.mergeAll(
  SqlitePersistenceMemory,
  AgentNotifications.layer.pipe(Layer.provide(SqlitePersistenceMemory)),
);
const layer = it.layer(repositoryLayer);

const sessionId = "notification-session" as AuthSessionId;
const environmentId = "notification-environment" as EnvironmentId;
const threadId = "notification-thread" as ThreadId;

layer("AgentNotificationRepository", (it) => {
  it.effect("baselines state, deduplicates replays, and permits later genuine requests", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const repository = yield* AgentNotifications.AgentNotificationRepository;
      yield* sql`
        INSERT INTO auth_sessions (
          session_id, subject, scopes, method, client_device_type,
          issued_at, expires_at, revoked_at
        ) VALUES (
          ${sessionId}, 'mobile', '["notifications:manage"]', 'bearer-access-token', 'mobile',
          '2026-07-21T00:00:00.000Z', '2099-01-01T00:00:00.000Z', NULL
        )
      `;
      yield* repository.upsertDevice({
        sessionId,
        deviceId: "iphone-test",
        registration: {
          label: "Test iPhone",
          platform: "ios",
          pushToken: "0123456789abcdef",
          bundleId: "com.goncalloramos.t3code.mobile",
          apsEnvironment: "sandbox",
          appVersion: "0.29.0",
          iosMajorVersion: 18,
          preferences: {
            notificationsEnabled: true,
            notifyOnApproval: true,
            notifyOnInput: true,
            notifyOnCompletion: true,
            notifyOnFailure: true,
          },
        },
      });

      const project = (phase: string, updatedAt: string) =>
        repository.project({
          threadId,
          phase,
          updatedAt,
          now: "2026-07-21T12:00:30.000Z",
          payload:
            phase === "running"
              ? null
              : {
                  title: phase,
                  body: "Test notification",
                  environmentId,
                  threadId,
                  deepLink: `/threads/${environmentId}/${threadId}`,
                  phase: phase as
                    | "waiting_for_approval"
                    | "waiting_for_input"
                    | "completed"
                    | "failed",
                  updatedAt,
                },
        });

      assert.equal(yield* project("running", "2026-07-21T12:00:00.000Z"), 0);
      assert.equal(yield* project("waiting_for_approval", "2026-07-21T12:00:05.000Z"), 1);
      assert.equal(yield* project("waiting_for_approval", "2026-07-21T12:00:05.000Z"), 0);
      assert.equal(yield* project("running", "2026-07-21T12:00:10.000Z"), 0);
      assert.equal(yield* project("waiting_for_approval", "2026-07-21T12:00:15.000Z"), 1);
      assert.equal(yield* project("running", "2026-07-21T12:00:20.000Z"), 0);
      assert.equal(yield* project("completed", "2026-07-21T12:00:25.000Z"), 1);

      const jobs = yield* sql<{ readonly phase: string }>`
        SELECT phase FROM agent_notification_jobs ORDER BY created_at, transition_id
      `;
      assert.deepStrictEqual(jobs.map((job) => job.phase).sort(), [
        "completed",
        "waiting_for_approval",
        "waiting_for_approval",
      ]);

      const inputThreadId = "input-and-failure-thread" as ThreadId;
      const projectOtherThread = (phase: string, updatedAt: string) =>
        repository.project({
          threadId: inputThreadId,
          phase,
          updatedAt,
          now: "2026-07-21T12:01:00.000Z",
          payload:
            phase === "running"
              ? null
              : {
                  title: phase,
                  body: "Test notification",
                  environmentId,
                  threadId: inputThreadId,
                  deepLink: `/threads/${environmentId}/${inputThreadId}`,
                  phase: phase as "waiting_for_input" | "failed",
                  updatedAt,
                },
        });
      assert.equal(yield* projectOtherThread("running", "2026-07-21T12:00:40.000Z"), 0);
      assert.equal(yield* projectOtherThread("waiting_for_input", "2026-07-21T12:00:45.000Z"), 1);
      assert.equal(yield* projectOtherThread("running", "2026-07-21T12:00:50.000Z"), 0);
      assert.equal(yield* projectOtherThread("failed", "2026-07-21T12:00:55.000Z"), 1);

      const newThreadId = "new-thread-baseline" as ThreadId;
      const projectNewThread = (phase: "starting" | "running" | "completed", updatedAt: string) =>
        repository.project({
          threadId: newThreadId,
          phase,
          updatedAt,
          now: "2026-07-21T12:01:00.000Z",
          payload:
            phase === "completed"
              ? {
                  title: "New thread",
                  body: "Completed",
                  environmentId,
                  threadId: newThreadId,
                  deepLink: `/threads/${environmentId}/${newThreadId}`,
                  phase,
                  updatedAt,
                }
              : null,
        });
      assert.equal(yield* projectNewThread("starting", "2026-07-21T12:00:56.000Z"), 0);
      assert.equal(yield* projectNewThread("completed", "2026-07-21T12:00:57.000Z"), 0);
      assert.equal(yield* projectNewThread("running", "2026-07-21T12:00:58.000Z"), 0);
      assert.equal(yield* projectNewThread("completed", "2026-07-21T12:00:59.000Z"), 1);

      yield* repository.upsertDevice({
        sessionId,
        deviceId: "iphone-test",
        registration: {
          label: "Test iPhone",
          platform: "ios",
          pushToken: "fedcba9876543210",
          bundleId: "com.goncalloramos.t3code.mobile",
          apsEnvironment: "sandbox",
          appVersion: "0.29.0",
          iosMajorVersion: 18,
          preferences: {
            notificationsEnabled: true,
            notifyOnApproval: false,
            notifyOnInput: false,
            notifyOnCompletion: false,
            notifyOnFailure: false,
          },
        },
      });
      const suppressedThreadId = "suppressed-thread" as ThreadId;
      assert.equal(
        yield* repository.project({
          threadId: suppressedThreadId,
          phase: "running",
          updatedAt: "2026-07-21T12:01:05.000Z",
          payload: null,
          now: "2026-07-21T12:01:10.000Z",
        }),
        0,
      );
      assert.equal(
        yield* repository.project({
          threadId: suppressedThreadId,
          phase: "waiting_for_approval",
          updatedAt: "2026-07-21T12:01:06.000Z",
          payload: {
            title: "Approval",
            body: "Suppressed",
            environmentId,
            threadId: suppressedThreadId,
            deepLink: `/threads/${environmentId}/${suppressedThreadId}`,
            phase: "waiting_for_approval",
            updatedAt: "2026-07-21T12:01:06.000Z",
          },
          now: "2026-07-21T12:01:10.000Z",
        }),
        0,
      );

      const oldThreadId = "old-terminal-thread" as ThreadId;
      assert.equal(
        yield* repository.project({
          threadId: oldThreadId,
          phase: "running",
          updatedAt: "2020-01-01T00:00:00.000Z",
          payload: null,
          now: "2026-07-21T12:00:30.000Z",
        }),
        0,
      );
      assert.equal(
        yield* repository.project({
          threadId: oldThreadId,
          phase: "completed",
          updatedAt: "2020-01-01T00:00:10.000Z",
          payload: {
            title: "completed",
            body: "Old result",
            environmentId,
            threadId: oldThreadId,
            deepLink: `/threads/${environmentId}/${oldThreadId}`,
            phase: "completed",
            updatedAt: "2020-01-01T00:00:10.000Z",
          },
          now: "2026-07-21T12:00:30.000Z",
        }),
        0,
      );

      yield* sql`UPDATE auth_sessions SET revoked_at = '2026-07-21T12:00:40.000Z' WHERE session_id = ${sessionId}`;
      assert.equal(
        (yield* repository.pendingJobs({ now: "2026-07-21T12:00:45.000Z", limit: 20 })).length,
        0,
      );
      const status = yield* repository.status({
        sessionId,
        environmentId,
        supported: true,
        credentialsConfigured: true,
        hostedRelayActive: false,
      });
      assert.equal(status.activeDeviceCount, 0);
      assert.isTrue(yield* repository.removeDevice({ sessionId, deviceId: "iphone-test" }));
      assert.isFalse(yield* repository.removeDevice({ sessionId, deviceId: "iphone-test" }));
    }),
  );
});
