// @effect-diagnostics globalDateInEffect:off - The migration snapshots one wall-clock boundary for SQL filtering.
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const appendNotificationScope = (json: string): string => {
  try {
    const scopes = JSON.parse(json) as unknown;
    if (!Array.isArray(scopes)) return json;
    const strings = scopes.filter((scope): scope is string => typeof scope === "string");
    return JSON.stringify(
      strings.includes("notifications:manage") ? strings : [...strings, "notifications:manage"],
    );
  } catch {
    return json;
  }
};

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const now = new Date().toISOString();
  const rows = yield* sql<{ readonly sessionId: string; readonly scopes: string }>`
    SELECT session_id AS "sessionId", scopes
    FROM auth_sessions
    WHERE client_device_type = 'mobile'
      AND revoked_at IS NULL
      AND expires_at > ${now}
  `;
  for (const row of rows) {
    const scopes = appendNotificationScope(row.scopes);
    if (scopes !== row.scopes) {
      yield* sql`UPDATE auth_sessions SET scopes = ${scopes} WHERE session_id = ${row.sessionId}`;
    }
  }
});
