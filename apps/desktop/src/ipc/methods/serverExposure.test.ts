import type { DesktopRemoteModeState, DesktopServerExposureState } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as DesktopLifecycle from "../../app/DesktopLifecycle.ts";
import * as DesktopRemoteAccess from "../../app/DesktopRemoteAccess.ts";
import * as DesktopShutdown from "../../app/DesktopShutdown.ts";
import * as DesktopState from "../../app/DesktopState.ts";
import * as DesktopServerExposure from "../../backend/DesktopServerExposure.ts";
import * as ElectronApp from "../../electron/ElectronApp.ts";
import * as ElectronTheme from "../../electron/ElectronTheme.ts";
import * as DesktopWindow from "../../window/DesktopWindow.ts";
import { setServerExposureMode } from "./serverExposure.ts";

const remoteModeReadyState: DesktopRemoteModeState = {
  preferences: {
    enabled: true,
    preventSystemSleep: true,
    launchAtLogin: true,
  },
  status: "ready",
  endpointUrl: "https://mac.tail.test/",
  environmentId: null,
  sleepAssertionActive: true,
  loginItemActive: true,
  detail: null,
};

const networkAccessibleState: DesktopServerExposureState = {
  mode: "network-accessible",
  endpointUrl: "http://192.168.1.20:3773",
  advertisedHost: "192.168.1.20",
  tailscaleServeEnabled: false,
  tailscaleServePort: 443,
};

const unusedLifecycleRuntimeLayer = Layer.mergeAll(
  DesktopShutdown.layer,
  DesktopState.layer,
  Layer.succeed(
    DesktopEnvironment.DesktopEnvironment,
    DesktopEnvironment.DesktopEnvironment.of(
      {} as DesktopEnvironment.DesktopEnvironment["Service"],
    ),
  ),
  Layer.succeed(
    DesktopWindow.DesktopWindow,
    DesktopWindow.DesktopWindow.of({} as DesktopWindow.DesktopWindow["Service"]),
  ),
  Layer.succeed(
    ElectronApp.ElectronApp,
    ElectronApp.ElectronApp.of({} as ElectronApp.ElectronApp["Service"]),
  ),
  Layer.succeed(
    ElectronTheme.ElectronTheme,
    ElectronTheme.ElectronTheme.of({} as ElectronTheme.ElectronTheme["Service"]),
  ),
);

describe("server exposure IPC", () => {
  it.effect("disables Remote Mode before enabling network access and relaunches once", () => {
    const events: Array<string> = [];
    const layer = Layer.mergeAll(
      Layer.succeed(
        DesktopLifecycle.DesktopLifecycle,
        DesktopLifecycle.DesktopLifecycle.of({
          relaunch: (reason) =>
            Effect.sync(() => {
              events.push(`relaunch:${reason}`);
            }),
          register: Effect.void,
        }),
      ),
      Layer.succeed(
        DesktopRemoteAccess.DesktopRemoteAccess,
        DesktopRemoteAccess.DesktopRemoteAccess.of({
          getState: Effect.succeed(remoteModeReadyState),
          reconcile: Effect.succeed(remoteModeReadyState),
          setPreferences: (preferences) =>
            Effect.sync(() => {
              events.push(`remote-mode:${preferences.enabled ? "on" : "off"}`);
              return {
                state: {
                  ...remoteModeReadyState,
                  preferences,
                  status: "off" as const,
                  endpointUrl: null,
                },
                requiresRelaunch: true,
              };
            }),
        }),
      ),
      Layer.succeed(
        DesktopServerExposure.DesktopServerExposure,
        DesktopServerExposure.DesktopServerExposure.of({
          getState: Effect.succeed(networkAccessibleState),
          backendConfig: Effect.die("unused backend config"),
          configureFromSettings: () => Effect.die("unused exposure configuration"),
          setMode: (mode) =>
            Effect.sync(() => {
              events.push(`network-access:${mode}`);
              return { state: networkAccessibleState, requiresRelaunch: true };
            }),
          setTailscaleServeEnabled: () => Effect.die("unused Tailscale update"),
          getAdvertisedEndpoints: Effect.succeed([]),
        }),
      ),
      unusedLifecycleRuntimeLayer,
    );

    return Effect.gen(function* () {
      const state = yield* setServerExposureMode.handler("network-accessible");

      assert.deepEqual(state, networkAccessibleState);
      assert.deepEqual(events, [
        "remote-mode:off",
        "network-access:network-accessible",
        "relaunch:serverExposureMode=network-accessible;remote-mode-disabled",
      ]);
    }).pipe(Effect.provide(layer));
  });
});
