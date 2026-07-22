import * as NodeCrypto from "node:crypto";

import { describe, expect, it } from "@effect/vitest";

import {
  apnsHost,
  makeApnsAlertPayload,
  makeApnsAlertRequest,
  makeApnsProviderJwt,
  resetApnsProviderTokenCacheForTest,
  validateApnsPrivateKey,
} from "./apns.ts";

const keyPair = NodeCrypto.generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

describe("APNs primitives", () => {
  it("selects the Apple sandbox and production hosts", () => {
    expect(apnsHost("sandbox")).toBe("https://api.sandbox.push.apple.com");
    expect(apnsHost("production")).toBe("https://api.push.apple.com");
  });

  it("creates and caches a verifiable ES256 provider token", () => {
    resetApnsProviderTokenCacheForTest();
    const credentials = {
      teamId: "TEAM123456",
      keyId: "KEY1234567",
      privateKey: keyPair.privateKey,
    };
    const jwt = makeApnsProviderJwt(credentials, 1_800_000_000);
    expect(makeApnsProviderJwt(credentials, 1_800_000_010)).toBe(jwt);
    const [header, payload, signature] = jwt.split(".");
    expect(JSON.parse(Buffer.from(header!, "base64url").toString("utf8"))).toEqual({
      alg: "ES256",
      kid: credentials.keyId,
    });
    expect(JSON.parse(Buffer.from(payload!, "base64url").toString("utf8"))).toMatchObject({
      iss: credentials.teamId,
    });
    expect(
      NodeCrypto.verify(
        "sha256",
        Buffer.from(`${header}.${payload}`),
        { key: keyPair.publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(signature!, "base64url"),
      ),
    ).toBe(true);
  });

  it("rejects non-P-256 and non-PKCS#8 keys", () => {
    const wrongCurve = NodeCrypto.generateKeyPairSync("ec", {
      namedCurve: "secp384r1",
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    expect(() => validateApnsPrivateKey(wrongCurve.privateKey)).toThrow(/P-256/);
    expect(() => validateApnsPrivateKey("secret")).toThrow(/PKCS#8/);
  });

  it("builds a bounded alert payload with validated navigation data", () => {
    expect(
      makeApnsAlertPayload({
        title: "Approval required",
        body: "Review the command",
        environmentId: "environment-test",
        threadId: "thread-test",
        deepLink: "/threads/environment-test/thread-test",
        phase: "waiting_for_approval",
      }),
    ).toMatchObject({
      aps: { alert: { title: "Approval required", body: "Review the command" }, sound: "default" },
      environmentId: "environment-test",
      threadId: "thread-test",
      deepLink: "/threads/environment-test/thread-test",
    });
  });

  it("builds alert requests with the APNs topic, priority, push type, and safe payload", () => {
    const request = makeApnsAlertRequest({
      credentials: {
        teamId: "TEAM123456",
        keyId: "KEY1234567",
        bundleId: "com.goncalloramos.t3code.mobile",
        privateKey: keyPair.privateKey,
      },
      environment: "sandbox",
      token: "0123456789abcdef",
      notification: {
        title: "Input required",
        body: "Choose an option",
        environmentId: "environment-test",
        threadId: "thread-test",
        deepLink: "/threads/environment-test/thread-test",
        phase: "waiting_for_input",
      },
      nowUnixSeconds: 1_800_000_000,
    });

    expect(request.host).toBe("https://api.sandbox.push.apple.com");
    expect(request.headers).toMatchObject({
      ":method": "POST",
      ":path": "/3/device/0123456789abcdef",
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-topic": "com.goncalloramos.t3code.mobile",
    });
    expect(request.headers.authorization).toMatch(/^bearer [^.]+\.[^.]+\.[^.]+$/);
    expect(JSON.parse(request.body)).toMatchObject({
      environmentId: "environment-test",
      threadId: "thread-test",
      deepLink: "/threads/environment-test/thread-test",
    });
  });
});
