import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  AgentNotificationDeviceRegistration,
  AuthNotificationsManageScope,
  AuthStandardClientScopes,
  AuthStandardMobileClientScopes,
  ExecutionEnvironmentDescriptor,
} from "./index.ts";

const validRegistration = {
  label: "Gonçalo’s iPhone",
  platform: "ios",
  pushToken: "0123456789abcdef",
  bundleId: "com.goncalloramos.t3code.mobile",
  apsEnvironment: "sandbox",
  appVersion: "0.29.0",
  iosMajorVersion: 18,
  preferences: {
    notificationsEnabled: true,
    notifyOnApproval: true,
    notifyOnInput: true,
    notifyOnCompletion: true,
    notifyOnFailure: true,
  },
} as const;

const decodeEnvironmentDescriptor = Schema.decodeUnknownSync(ExecutionEnvironmentDescriptor);
const decodeRegistration = Schema.decodeUnknownSync(AgentNotificationDeviceRegistration);

describe("direct agent notification contracts", () => {
  it("defaults the capability to false for older environment descriptors", () => {
    const decoded = decodeEnvironmentDescriptor({
      environmentId: "environment-test",
      label: "Older Mac",
      platform: { os: "darwin", arch: "arm64" },
      serverVersion: "0.28.0",
      capabilities: { repositoryIdentity: true },
    });
    expect(decoded.capabilities.directAgentNotifications).toBe(false);
  });

  it("accepts a valid iOS registration", () => {
    expect(decodeRegistration(validRegistration)).toEqual(validRegistration);
  });

  it("grants notification management to standard mobile clients only", () => {
    expect(AuthStandardMobileClientScopes).toContain(AuthNotificationsManageScope);
    expect(AuthStandardClientScopes).not.toContain(AuthNotificationsManageScope);
  });

  it.each([
    ["malformed token", { ...validRegistration, pushToken: "not-a-token" }],
    ["odd-length token", { ...validRegistration, pushToken: "0123456789abcde" }],
    ["empty token", { ...validRegistration, pushToken: "" }],
    ["wrong bundle", { ...validRegistration, bundleId: "com.example.other" }],
    ["wrong environment", { ...validRegistration, apsEnvironment: "development" }],
    ["wrong platform", { ...validRegistration, platform: "android" }],
  ])("rejects %s", (_label, input) => {
    expect(() => decodeRegistration(input)).toThrow();
  });
});
