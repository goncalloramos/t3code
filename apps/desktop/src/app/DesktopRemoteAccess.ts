import type {
  AdvertisedEndpoint,
  DesktopServerExposureMode,
  DesktopRemoteModePreferences,
  DesktopRemoteModeState,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as DesktopServerExposure from "../backend/DesktopServerExposure.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as DesktopAppSettings from "../settings/DesktopAppSettings.ts";
import * as DesktopHostAwake from "./DesktopHostAwake.ts";

export class DesktopRemoteAccessError extends Schema.TaggedErrorClass<DesktopRemoteAccessError>()(
  "DesktopRemoteAccessError",
  { operation: Schema.Literals(["read", "reconcile", "persist"]), cause: Schema.Defect() },
) {
  override get message(): string {
    return `Desktop Remote Mode failed during ${this.operation}.`;
  }
}

export interface DesktopRemoteAccessChange {
  readonly state: DesktopRemoteModeState;
  readonly requiresRelaunch: boolean;
}

export class DesktopRemoteAccess extends Context.Service<
  DesktopRemoteAccess,
  {
    readonly getState: Effect.Effect<DesktopRemoteModeState, DesktopRemoteAccessError>;
    readonly reconcile: Effect.Effect<DesktopRemoteModeState, DesktopRemoteAccessError>;
    readonly setPreferences: (
      preferences: DesktopRemoteModePreferences,
    ) => Effect.Effect<DesktopRemoteAccessChange, DesktopRemoteAccessError>;
  }
>()("@t3tools/desktop/app/DesktopRemoteAccess") {}

const toPreferences = (
  settings: DesktopAppSettings.DesktopSettings,
): DesktopRemoteModePreferences => ({
  enabled: settings.remoteModeEnabled,
  preventSystemSleep: settings.remoteModePreventSystemSleep,
  launchAtLogin: settings.remoteModeLaunchAtLogin,
});

export const resolveRemoteModeExposureMode = (
  enabled: boolean,
  currentMode: DesktopServerExposureMode,
): DesktopServerExposureMode => (enabled ? "local-only" : currentMode);

export const resolveDesktopRemoteModeState = (input: {
  readonly preferences: DesktopRemoteModePreferences;
  readonly sleepAssertionActive: boolean;
  readonly loginItemActive: boolean;
  readonly endpoints: readonly AdvertisedEndpoint[];
}): DesktopRemoteModeState => {
  if (!input.preferences.enabled) {
    return {
      preferences: input.preferences,
      status: "off",
      endpointUrl: null,
      environmentId: null,
      sleepAssertionActive: input.sleepAssertionActive,
      loginItemActive: input.loginItemActive,
      detail: null,
    };
  }

  const endpoint = input.endpoints.find(
    (candidate) =>
      candidate.provider.id === "tailscale" && candidate.httpBaseUrl.startsWith("https://"),
  );
  if (!endpoint) {
    return {
      preferences: input.preferences,
      status: "tailscale-unavailable",
      endpointUrl: null,
      environmentId: null,
      sleepAssertionActive: input.sleepAssertionActive,
      loginItemActive: input.loginItemActive,
      detail: "Start Tailscale and enable MagicDNS, then retry Remote Mode.",
    };
  }

  const ready = endpoint.status === "available";
  return {
    preferences: input.preferences,
    status: ready ? "ready" : "endpoint-unverified",
    endpointUrl: endpoint.httpBaseUrl,
    environmentId: null,
    sleepAssertionActive: input.sleepAssertionActive,
    loginItemActive: input.loginItemActive,
    detail: ready ? null : "The Tailscale HTTPS endpoint could not be verified.",
  };
};

export const resolveRemoteModeLoginItemAction = (input: {
  readonly shouldLaunchAtLogin: boolean;
  readonly loginItemActive: boolean;
  readonly remoteModeOwnsLoginItem: boolean;
}): "enable-owned" | "disable-owned" | "none" => {
  if (input.shouldLaunchAtLogin && !input.loginItemActive) return "enable-owned";
  if (!input.shouldLaunchAtLogin && input.remoteModeOwnsLoginItem) return "disable-owned";
  return "none";
};

export const make = Effect.gen(function* () {
  const settings = yield* DesktopAppSettings.DesktopAppSettings;
  const exposure = yield* DesktopServerExposure.DesktopServerExposure;
  const electronApp = yield* ElectronApp.ElectronApp;
  const hostAwake = yield* DesktopHostAwake.DesktopHostAwake;

  const enforceLoopbackExposure = Effect.fn("desktop.remoteAccess.enforceLoopbackExposure")(
    function* (enabled: boolean) {
      const currentSettings = yield* settings.get;
      const requiredMode = resolveRemoteModeExposureMode(
        enabled,
        currentSettings.serverExposureMode,
      );
      if (requiredMode === currentSettings.serverExposureMode) {
        return false;
      }
      const change = yield* exposure.setMode(requiredMode);
      return change.requiresRelaunch;
    },
  );

  const applyRuntimePreferences = Effect.fn("desktop.remoteAccess.applyRuntimePreferences")(
    function* (preferences: DesktopRemoteModePreferences) {
      const shouldPreventSleep = preferences.enabled && preferences.preventSystemSleep;
      const shouldLaunchAtLogin = preferences.enabled && preferences.launchAtLogin;
      yield* hostAwake.setEnabled(shouldPreventSleep);
      const currentSettings = yield* settings.get;
      const loginItemSettings = yield* electronApp.getLoginItemSettings;
      const loginItemAction = resolveRemoteModeLoginItemAction({
        shouldLaunchAtLogin,
        loginItemActive: loginItemSettings.openAtLogin,
        remoteModeOwnsLoginItem: currentSettings.remoteModeOwnsLoginItem === true,
      });
      if (loginItemAction === "enable-owned") {
        yield* electronApp.setLoginItemSettings({ openAtLogin: true });
        yield* settings.setRemoteModePreferences({
          ...preferences,
          ownsLoginItem: true,
        });
      } else if (loginItemAction === "disable-owned") {
        yield* electronApp.setLoginItemSettings({ openAtLogin: false });
        yield* settings.setRemoteModePreferences({
          ...preferences,
          ownsLoginItem: false,
        });
      }
    },
    Effect.mapError((cause) => new DesktopRemoteAccessError({ operation: "reconcile", cause })),
  );

  const readState = Effect.fn("desktop.remoteAccess.getState")(
    function* () {
      const currentSettings = yield* settings.get;
      const preferences = toPreferences(currentSettings);
      const [sleepAssertionActive, loginSettings, endpoints] = yield* Effect.all([
        hostAwake.active,
        electronApp.getLoginItemSettings,
        exposure.getAdvertisedEndpoints,
      ]);

      return resolveDesktopRemoteModeState({
        preferences,
        sleepAssertionActive,
        loginItemActive: loginSettings.openAtLogin,
        endpoints,
      });
    },
    Effect.mapError((cause) => new DesktopRemoteAccessError({ operation: "read", cause })),
  );

  const reconcile = Effect.fn("desktop.remoteAccess.reconcile")(
    function* () {
      const currentSettings = yield* settings.get;
      const preferences = toPreferences(currentSettings);
      yield* applyRuntimePreferences(preferences);
      yield* enforceLoopbackExposure(preferences.enabled);
      if (currentSettings.tailscaleServeEnabled !== preferences.enabled) {
        yield* settings.setTailscaleServe({ enabled: preferences.enabled, port: Option.none() });
      }
      return yield* readState();
    },
    Effect.mapError((cause) => new DesktopRemoteAccessError({ operation: "reconcile", cause })),
  );

  const setPreferences = Effect.fn("desktop.remoteAccess.setPreferences")(
    function* (preferences: DesktopRemoteModePreferences) {
      const preferenceChange = yield* settings.setRemoteModePreferences(preferences);
      const exposureRequiresRelaunch = yield* enforceLoopbackExposure(preferences.enabled);
      const tailscaleChange = yield* settings.setTailscaleServe({
        enabled: preferences.enabled,
        port: Option.none(),
      });
      yield* applyRuntimePreferences(preferences);
      const state = yield* readState();
      const requiresRelaunch =
        preferenceChange.changed || tailscaleChange.changed || exposureRequiresRelaunch;
      return {
        state: requiresRelaunch ? { ...state, status: "restart-required" as const } : state,
        requiresRelaunch,
      };
    },
    Effect.mapError((cause) => new DesktopRemoteAccessError({ operation: "persist", cause })),
  );

  return DesktopRemoteAccess.of({
    getState: readState(),
    reconcile: reconcile(),
    setPreferences,
  });
});

export const layer = Layer.effect(DesktopRemoteAccess, make);
