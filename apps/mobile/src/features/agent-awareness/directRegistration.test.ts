import { describe, expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { SavedRemoteConnection } from "../../lib/connection";
import {
  __resetDirectNotificationRegistrationForTest,
  getDirectNotificationEnvironmentStates,
  synchronizeDirectNotificationRegistration,
} from "./directRegistration";

vi.mock("../../lib/connection", () => ({
  isRelayManagedConnection: (value: { readonly relayManaged?: boolean }) =>
    value.relayManaged === true,
}));

const connection = (id: string, host: string): SavedRemoteConnection => ({
  environmentId: id as EnvironmentId,
  environmentLabel: id,
  pairingUrl: `https://${host}/pair`,
  displayUrl: `https://${host}`,
  httpBaseUrl: `https://${host}`,
  wsBaseUrl: `wss://${host}/ws`,
  bearerToken: `token-${id}`,
});

const registration = {
  label: "Test iPhone",
  platform: "ios" as const,
  pushToken: "0123456789abcdef",
  bundleId: "com.goncalloramos.t3code.mobile" as const,
  apsEnvironment: "sandbox" as const,
  appVersion: "0.29.0",
  iosMajorVersion: 18,
  preferences: {
    notificationsEnabled: true,
    notifyOnApproval: true,
    notifyOnInput: true,
    notifyOnCompletion: true,
    notifyOnFailure: true,
  },
};

const json = (body: unknown, status = 200) =>
  Promise.resolve(Response.json(body, { status, headers: { "content-type": "application/json" } }));

describe("direct notification environment registration", () => {
  it.effect("registers through the authenticated environment API", () => {
    __resetDirectNotificationRegistrationForTest();
    const requests: Request[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      if (request.url.endsWith("/.well-known/t3/environment")) {
        return json({
          environmentId: "env-direct",
          label: "Direct Mac",
          platform: { os: "darwin", arch: "arm64" },
          serverVersion: "0.29.0",
          capabilities: { repositoryIdentity: true, directAgentNotifications: true },
        });
      }
      if (request.url.endsWith("/api/agent-notifications/status")) {
        return json({
          environmentId: "env-direct",
          supported: true,
          credentialsConfigured: true,
          hostedRelayActive: false,
          callerRegistration: null,
          activeDeviceCount: 0,
          sandboxDeviceCount: 0,
          productionDeviceCount: 0,
          lastDelivery: null,
        });
      }
      return json({
        registered: true,
        registration: {
          deviceId: "device-1",
          ...registration,
          appVersion: "0.29.0",
          updatedAt: "2026-07-21T12:00:00.000Z",
          disabledAt: null,
          failureReason: null,
        },
      });
    };

    return Effect.gen(function* () {
      try {
        expect(
          yield* synchronizeDirectNotificationRegistration({
            connection: connection("env-direct", "direct.example"),
            deviceId: "device-1",
            registration,
          }),
        ).toBe(true);
        expect(
          requests.map((request) => `${request.method} ${new URL(request.url).pathname}`),
        ).toEqual([
          "GET /.well-known/t3/environment",
          "GET /api/agent-notifications/status",
          "PUT /api/agent-notifications/devices/device-1",
        ]);
        expect(requests[2]?.headers.get("authorization")).toBe("Bearer token-env-direct");
        expect(getDirectNotificationEnvironmentStates()).toMatchObject([
          { environmentId: "env-direct", state: "registered" },
        ]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  it.effect("keeps partial multi-environment failures visible", () => {
    __resetDirectNotificationRegistrationForTest();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      const request = new Request(input, init);
      const host = new URL(request.url).host;
      if (host === "offline.example") return Promise.reject(new Error("offline"));
      if (request.url.endsWith("/.well-known/t3/environment")) {
        return json({
          environmentId: "env-online",
          label: "Online Mac",
          platform: { os: "darwin", arch: "arm64" },
          serverVersion: "0.29.0",
          capabilities: { repositoryIdentity: true, directAgentNotifications: true },
        });
      }
      if (request.url.endsWith("/status")) {
        return json({
          environmentId: "env-online",
          supported: true,
          credentialsConfigured: true,
          hostedRelayActive: false,
          callerRegistration: null,
          activeDeviceCount: 0,
          sandboxDeviceCount: 0,
          productionDeviceCount: 0,
          lastDelivery: null,
        });
      }
      return json({
        registered: true,
        registration: {
          deviceId: "device-1",
          ...registration,
          appVersion: "0.29.0",
          updatedAt: "2026-07-21T12:00:00.000Z",
          disabledAt: null,
          failureReason: null,
        },
      });
    };

    return Effect.gen(function* () {
      try {
        const results = yield* Effect.all(
          [
            synchronizeDirectNotificationRegistration({
              connection: connection("env-online", "online.example"),
              deviceId: "device-1",
              registration,
            }),
            synchronizeDirectNotificationRegistration({
              connection: connection("env-offline", "offline.example"),
              deviceId: "device-1",
              registration,
            }),
          ],
          { concurrency: 2 },
        );
        expect(results).toEqual([true, false]);
        expect(getDirectNotificationEnvironmentStates()).toMatchObject([
          { environmentId: "env-offline", state: "unreachable" },
          { environmentId: "env-online", state: "registered" },
        ]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
