import type {
  AgentNotificationEnvironmentStatus,
  DesktopApnsConfigurationStatus,
} from "@t3tools/contracts";
import { BellRingIcon, KeyRoundIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { fetchPrimaryEnvironment } from "../../environments/primary/fetch";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { SettingsRow } from "./settingsLayout";

async function readJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
    throw new Error(
      typeof body?.message === "string" ? body.message : `Request failed (${response.status}).`,
    );
  }
  return (await response.json()) as T;
}

export function IosNotificationsRows() {
  const bridge = window.desktopBridge;
  const [configuration, setConfiguration] = useState<DesktopApnsConfigurationStatus | null>(null);
  const [environmentStatus, setEnvironmentStatus] =
    useState<AgentNotificationEnvironmentStatus | null>(null);
  const [teamId, setTeamId] = useState("");
  const [keyId, setKeyId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"load" | "import" | "remove" | "test" | null>("load");

  const refreshEnvironmentStatus = useCallback(async () => {
    try {
      const status = await readJsonResponse<AgentNotificationEnvironmentStatus>(
        await fetchPrimaryEnvironment("/api/agent-notifications/status"),
      );
      setEnvironmentStatus(status);
    } catch (cause) {
      // A newly restarted backend may not have restored the renderer session
      // yet. Configuration status remains useful while this retries later.
      setEnvironmentStatus(null);
      if (configuration?.configured) {
        setError(cause instanceof Error ? cause.message : "Could not read notification status.");
      }
    }
  }, [configuration?.configured]);

  const refresh = useCallback(async () => {
    if (!bridge) return;
    setBusy("load");
    setError(null);
    try {
      const next = await bridge.getApnsConfigurationStatus();
      setConfiguration(next);
      setTeamId((current) => current || next.teamId || "");
      setKeyId((current) => current || next.keyId || "");
      await refreshEnvironmentStatus();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read APNs configuration.");
    } finally {
      setBusy(null);
    }
  }, [bridge, refreshEnvironmentStatus]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!bridge) return null;

  const importCredentials = async () => {
    if (!teamId.trim() || !keyId.trim()) {
      setError("Enter the Apple Team ID and APNs Key ID first.");
      return;
    }
    setBusy("import");
    setError(null);
    try {
      const next = await bridge.importApnsCredentials({
        teamId: teamId.trim(),
        keyId: keyId.trim(),
      });
      setConfiguration(next);
      toastManager.add({
        type: "success",
        title: "APNs credentials saved",
        description: "The primary local backend was restarted with the encrypted key.",
      });
      window.setTimeout(() => void refreshEnvironmentStatus(), 1_500);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not import APNs credentials.";
      setError(message);
      toastManager.add(
        stackedThreadToast({ type: "error", title: "Import failed", description: message }),
      );
    } finally {
      setBusy(null);
    }
  };

  const removeCredentials = async () => {
    if (!(await bridge.confirm("Remove the encrypted APNs credentials from this Mac?"))) return;
    setBusy("remove");
    setError(null);
    try {
      const next = await bridge.removeApnsCredentials();
      setConfiguration(next);
      setEnvironmentStatus(null);
      toastManager.add({
        type: "success",
        title: "APNs credentials removed",
        description: "The primary local backend was restarted without direct notifications.",
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove APNs credentials.");
    } finally {
      setBusy(null);
    }
  };

  const sendTest = async () => {
    setBusy("test");
    setError(null);
    try {
      const result = await readJsonResponse<{ queued: boolean }>(
        await fetchPrimaryEnvironment("/api/agent-notifications/devices/all/test", {
          method: "POST",
        }),
      );
      if (!result.queued) throw new Error("No registered iPhones are available.");
      toastManager.add({
        type: "success",
        title: "Test notification queued",
        description: "APNs delivery continues in the background.",
      });
      window.setTimeout(() => void refreshEnvironmentStatus(), 1_000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send a test notification.");
    } finally {
      setBusy(null);
    }
  };

  const configured = configuration?.configured === true;
  const delivery = environmentStatus?.lastDelivery;
  const statusText = error
    ? error
    : environmentStatus?.hostedRelayActive
      ? "Hosted agent activity publishing is active; direct registration is disabled to prevent duplicates."
      : configured
        ? `${environmentStatus?.activeDeviceCount ?? 0} registered iPhone${environmentStatus?.activeDeviceCount === 1 ? "" : "s"} · ${environmentStatus?.sandboxDeviceCount ?? 0} sandbox · ${environmentStatus?.productionDeviceCount ?? 0} production`
        : (configuration?.error ??
          "Choose an Apple APNs authentication key to enable direct delivery.");

  return (
    <>
      <SettingsRow
        title={
          <span className="inline-flex items-center gap-1.5">
            <BellRingIcon className="size-3.5" /> iOS Notifications
          </span>
        }
        description="Send approval, input, completion, and failure alerts directly from this Mac through Apple APNs."
        status={<span className={error ? "text-destructive" : undefined}>{statusText}</span>}
        control={
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={
                !configured || busy !== null || (environmentStatus?.activeDeviceCount ?? 0) === 0
              }
              onClick={() => void sendTest()}
            >
              {busy === "test" ? <Spinner className="size-3.5" /> : null}
              Send Test Notification
            </Button>
            {configured ? (
              <Button
                size="sm"
                variant="destructive"
                disabled={busy !== null}
                onClick={() => void removeCredentials()}
              >
                Remove Credentials
              </Button>
            ) : null}
          </div>
        }
      >
        <div className="grid gap-3 border-t border-border/60 py-4 sm:grid-cols-2">
          <label className="space-y-1.5 text-xs font-medium">
            Apple Team ID
            <Input
              value={teamId}
              onChange={(event) => setTeamId(event.target.value)}
              maxLength={32}
              placeholder="ABCDE12345"
            />
          </label>
          <label className="space-y-1.5 text-xs font-medium">
            APNs Key ID
            <Input
              value={keyId}
              onChange={(event) => setKeyId(event.target.value)}
              maxLength={32}
              placeholder="ABC123DEFG"
            />
          </label>
          <div className="flex items-center gap-3 sm:col-span-2">
            <Button
              disabled={busy !== null || !configuration?.supported}
              onClick={() => void importCredentials()}
            >
              {busy === "import" ? (
                <Spinner className="size-3.5" />
              ) : (
                <KeyRoundIcon className="size-3.5" />
              )}
              Choose .p8 and Save
            </Button>
            <span className="text-xs text-muted-foreground">
              The key is encrypted with macOS Keychain and never enters this renderer.
            </span>
          </div>
          {delivery ? (
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Last delivery: {delivery.outcome}
              {delivery.apnsStatus !== null ? ` · APNs ${delivery.apnsStatus}` : ""}
              {delivery.reason ? ` · ${delivery.reason}` : ""}
            </p>
          ) : null}
        </div>
      </SettingsRow>
    </>
  );
}
