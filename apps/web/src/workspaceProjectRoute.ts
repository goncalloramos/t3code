import type { WorkspaceConnectionSummary } from "@t3tools/client-runtime/workspace";

export function isWorkspaceProjectRouteResolved(
  connection: WorkspaceConnectionSummary | null,
): boolean {
  return (
    connection !== null &&
    connection.phase !== "available" &&
    connection.phase !== "connecting" &&
    connection.phase !== "reconnecting"
  );
}
