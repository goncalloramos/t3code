import type { DesktopPermissionSettingsTarget } from "@t3tools/contracts";
import { ExternalLinkIcon, KeyRoundIcon, ShieldCheckIcon, WrenchIcon } from "lucide-react";
import { useCallback, useState } from "react";

import { isElectron } from "../../env";
import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

interface PermissionDefinition {
  readonly target: DesktopPermissionSettingsTarget;
  readonly title: string;
  readonly description: string;
  readonly actionLabel?: string;
}

const CORE_PERMISSIONS: readonly PermissionDefinition[] = [
  {
    target: "notifications",
    title: "Notifications",
    description:
      "Receive an alert when an agent completes work or needs an answer. Enable alerts, sounds, and banners in macOS.",
  },
  {
    target: "keychain",
    title: "Keychain",
    description:
      "Protects authentication and connection secrets. When macOS asks about “T3Code Safe Storage,” choose Always Allow once.",
    actionLabel: "Open Keychain Access",
  },
];

const OPTIONAL_PERMISSIONS: readonly PermissionDefinition[] = [
  {
    target: "files-and-folders",
    title: "Files & Folders",
    description:
      "Controls access to protected Desktop, Documents, Downloads, and removable volumes.",
  },
  {
    target: "full-disk-access",
    title: "Full Disk Access",
    description:
      "Optional. Use only when repositories or tools must read protected locations that normal folder access cannot reach.",
  },
  {
    target: "accessibility",
    title: "Accessibility",
    description: "Optional. Allows approved automation tools to control other applications.",
  },
  {
    target: "screen-recording",
    title: "Screen & System Audio Recording",
    description:
      "Optional. Required only for tools that inspect or capture content from other applications.",
  },
  {
    target: "microphone",
    title: "Microphone",
    description: "Optional. Required only when a voice or audio feature requests microphone input.",
  },
  {
    target: "camera",
    title: "Camera",
    description: "Optional. Required only when a camera-based feature requests video input.",
  },
];

function PermissionRow({ permission }: { permission: PermissionDefinition }) {
  const [opening, setOpening] = useState(false);
  const openSettings = useCallback(() => {
    const bridge = window.desktopBridge;
    if (!bridge) return;

    setOpening(true);
    void bridge
      .openPermissionSettings(permission.target)
      .then((opened) => {
        if (opened) return;
        throw new Error("macOS did not open the requested settings page.");
      })
      .catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: `Could not open ${permission.title}`,
            description:
              error instanceof Error ? error.message : "The settings page is unavailable.",
          }),
        );
      })
      .finally(() => setOpening(false));
  }, [permission]);

  return (
    <SettingsRow
      title={permission.title}
      description={permission.description}
      control={
        <Button
          size="xs"
          variant="outline"
          disabled={!isElectron || opening}
          onClick={openSettings}
        >
          <ExternalLinkIcon className="size-3.5" />
          {permission.actionLabel ?? "Open Settings"}
        </Button>
      }
    />
  );
}

export function PermissionsSettingsPanel() {
  return (
    <SettingsPageContainer>
      <div className="space-y-2 px-1">
        <div className="flex items-center gap-2">
          <ShieldCheckIcon className="size-5 text-foreground/70" />
          <h1 className="text-lg font-semibold tracking-[-0.02em]">Permissions</h1>
        </div>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Review every macOS permission T3 Code may use in one place. macOS still asks for each
          protected capability separately, but these shortcuts take you directly to its control.
        </p>
      </div>

      <SettingsSection title="Core" icon={<KeyRoundIcon className="size-3.5" />}>
        {CORE_PERMISSIONS.map((permission) => (
          <PermissionRow key={permission.target} permission={permission} />
        ))}
      </SettingsSection>

      <SettingsSection title="Optional tools" icon={<WrenchIcon className="size-3.5" />}>
        {OPTIONAL_PERMISSIONS.map((permission) => (
          <PermissionRow key={permission.target} permission={permission} />
        ))}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
