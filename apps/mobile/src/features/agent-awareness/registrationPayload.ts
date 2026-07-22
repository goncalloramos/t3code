import type { RelayDeviceRegistrationRequest } from "@t3tools/contracts/relay";

import type { Preferences } from "../../persistence/mobile-preferences";
import { supportsAgentAwarenessPush } from "./capabilities";

// Development and local goncalloramos builds are Xcode-signed and receive
// sandbox APNs tokens. EAS distribution builds inject an explicit production
// override. The relay must use the environment that signed the binary: APNs
// tokens cannot be used interchangeably between its two endpoints.
export function resolveApsEnvironment(
  appVariant: unknown,
  configuredEnvironment?: unknown,
): "sandbox" | "production" {
  if (configuredEnvironment === "sandbox" || configuredEnvironment === "production") {
    return configuredEnvironment;
  }
  return appVariant === "development" || appVariant === "goncalloramos" ? "sandbox" : "production";
}

export function makeRelayDeviceRegistrationRequest(input: {
  readonly deviceId: string;
  readonly label: string;
  readonly iosMajorVersion: number;
  readonly appVersion?: string;
  readonly bundleId?: string;
  readonly apsEnvironment?: "sandbox" | "production";
  readonly pushToken?: string;
  readonly pushToStartToken?: string;
  readonly notificationsEnabled: boolean;
  readonly preferences: Preferences;
}): RelayDeviceRegistrationRequest {
  const pushAvailable = supportsAgentAwarenessPush();
  const liveActivitiesEnabled = pushAvailable && input.preferences.liveActivitiesEnabled !== false;
  return {
    deviceId: input.deviceId,
    label: input.label,
    platform: "ios",
    iosMajorVersion: input.iosMajorVersion,
    appVersion: input.appVersion,
    ...(input.bundleId ? { bundleId: input.bundleId } : {}),
    ...(input.apsEnvironment ? { apsEnvironment: input.apsEnvironment } : {}),
    ...(input.pushToken ? { pushToken: input.pushToken } : {}),
    ...(input.pushToStartToken ? { pushToStartToken: input.pushToStartToken } : {}),
    preferences: {
      liveActivitiesEnabled,
      notificationsEnabled:
        pushAvailable &&
        input.notificationsEnabled &&
        input.preferences.notificationsEnabled !== false,
      notifyOnApproval: input.preferences.notifyOnApproval !== false,
      notifyOnInput: input.preferences.notifyOnInput !== false,
      notifyOnCompletion: input.preferences.notifyOnCompletion !== false,
      notifyOnFailure: input.preferences.notifyOnFailure !== false,
    },
  };
}
