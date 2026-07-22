import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("034_AuthNotificationScope", (it) => {
  it.effect("backfills only active mobile sessions", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 33 });

      const insert = (input: {
        readonly id: string;
        readonly deviceType: string;
        readonly expiresAt: string;
        readonly revokedAt?: string;
      }) => sql`
        INSERT INTO auth_sessions (
          session_id, subject, scopes, method, client_device_type,
          issued_at, expires_at, revoked_at
        ) VALUES (
          ${input.id}, 'test', '["access:read"]', 'bearer-access-token', ${input.deviceType},
          '2026-01-01T00:00:00.000Z', ${input.expiresAt}, ${input.revokedAt ?? null}
        )
      `;
      yield* insert({
        id: "mobile-active",
        deviceType: "mobile",
        expiresAt: "2099-01-01T00:00:00.000Z",
      });
      yield* insert({
        id: "browser-active",
        deviceType: "browser",
        expiresAt: "2099-01-01T00:00:00.000Z",
      });
      yield* insert({
        id: "unknown-active",
        deviceType: "unknown",
        expiresAt: "2099-01-01T00:00:00.000Z",
      });
      yield* insert({
        id: "mobile-expired",
        deviceType: "mobile",
        expiresAt: "2000-01-01T00:00:00.000Z",
      });
      yield* insert({
        id: "mobile-revoked",
        deviceType: "mobile",
        expiresAt: "2099-01-01T00:00:00.000Z",
        revokedAt: "2026-01-02T00:00:00.000Z",
      });

      yield* runMigrations({ toMigrationInclusive: 34 });
      const rows = yield* sql<{ readonly id: string; readonly scopes: string }>`
        SELECT session_id AS id, scopes FROM auth_sessions ORDER BY session_id
      `;
      const scopes = Object.fromEntries(rows.map((row) => [row.id, JSON.parse(row.scopes)]));
      assert.include(scopes["mobile-active"], "notifications:manage");
      assert.notInclude(scopes["browser-active"], "notifications:manage");
      assert.notInclude(scopes["unknown-active"], "notifications:manage");
      assert.notInclude(scopes["mobile-expired"], "notifications:manage");
      assert.notInclude(scopes["mobile-revoked"], "notifications:manage");
    }),
  );
});
