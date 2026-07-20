import { createFileRoute } from "@tanstack/react-router";

import { PermissionsSettingsPanel } from "../components/settings/PermissionsSettings";

export const Route = createFileRoute("/settings/permissions")({
  component: PermissionsSettingsPanel,
});
