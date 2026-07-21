import { createAdvertisedEndpoint } from "@t3tools/shared/advertisedEndpoint";
import { assert, describe, it } from "@effect/vitest";

import {
  resolveDesktopRemoteModeState,
  resolveRemoteModeExposureMode,
  resolveRemoteModeLoginItemAction,
} from "./DesktopRemoteAccess.ts";

const preferences = {
  enabled: true,
  preventSystemSleep: true,
  launchAtLogin: true,
} as const;

const tailscaleEndpoint = (status: "available" | "unavailable") =>
  createAdvertisedEndpoint({
    id: "tailscale:https://mac.tail.test/",
    label: "Tailscale HTTPS",
    httpBaseUrl: "https://mac.tail.test/",
    reachability: "private-network",
    status,
    provider: {
      id: "tailscale",
      label: "Tailscale",
      kind: "private-network",
      isAddon: true,
    },
    source: "desktop-addon",
  });

describe("DesktopRemoteAccess", () => {
  it("keeps Remote Mode on loopback without widening a disabled configuration", () => {
    assert.equal(resolveRemoteModeExposureMode(true, "network-accessible"), "local-only");
    assert.equal(resolveRemoteModeExposureMode(true, "local-only"), "local-only");
    assert.equal(resolveRemoteModeExposureMode(false, "network-accessible"), "network-accessible");
  });

  it("stays off without exposing an endpoint when disabled", () => {
    const state = resolveDesktopRemoteModeState({
      preferences: { ...preferences, enabled: false },
      sleepAssertionActive: false,
      loginItemActive: false,
      endpoints: [tailscaleEndpoint("available")],
    });
    assert.equal(state.status, "off");
    assert.isNull(state.endpointUrl);
  });

  it("reports missing Tailscale without affecting the local app", () => {
    const state = resolveDesktopRemoteModeState({
      preferences,
      sleepAssertionActive: true,
      loginItemActive: true,
      endpoints: [],
    });
    assert.equal(state.status, "tailscale-unavailable");
  });

  it("only marks a verified Tailscale HTTPS endpoint ready", () => {
    const unverified = resolveDesktopRemoteModeState({
      preferences,
      sleepAssertionActive: true,
      loginItemActive: true,
      endpoints: [tailscaleEndpoint("unavailable")],
    });
    const ready = resolveDesktopRemoteModeState({
      preferences,
      sleepAssertionActive: true,
      loginItemActive: true,
      endpoints: [tailscaleEndpoint("available")],
    });
    assert.equal(unverified.status, "endpoint-unverified");
    assert.equal(ready.status, "ready");
    assert.equal(ready.endpointUrl, "https://mac.tail.test/");
  });

  it("only removes a login item that Remote Mode created", () => {
    assert.equal(
      resolveRemoteModeLoginItemAction({
        shouldLaunchAtLogin: false,
        loginItemActive: true,
        remoteModeOwnsLoginItem: false,
      }),
      "none",
    );
    assert.equal(
      resolveRemoteModeLoginItemAction({
        shouldLaunchAtLogin: false,
        loginItemActive: true,
        remoteModeOwnsLoginItem: true,
      }),
      "disable-owned",
    );
    assert.equal(
      resolveRemoteModeLoginItemAction({
        shouldLaunchAtLogin: true,
        loginItemActive: false,
        remoteModeOwnsLoginItem: false,
      }),
      "enable-owned",
    );
  });
});
