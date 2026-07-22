import * as NodeCrypto from "node:crypto";
import * as NodeHttp2 from "node:http2";

import { p256 } from "@noble/curves/nist";
import { sha256 } from "@noble/hashes/sha2";

export type ApnsEnvironment = "sandbox" | "production";

export interface ApnsCredentials {
  readonly teamId: string;
  readonly keyId: string;
  readonly bundleId: string;
  readonly privateKey: string;
}

export interface ApnsNotificationPayload {
  readonly title: string;
  readonly body: string;
  readonly environmentId: string;
  readonly threadId: string;
  readonly deepLink: string;
  readonly phase?: string;
  readonly updatedAt?: string;
}

export interface ApnsDeliveryResult {
  readonly ok: boolean;
  readonly status: number;
  readonly reason: string | null;
  readonly apnsId: string | null;
}

export class SafeApnsError extends Error {
  readonly status: number | null;
  readonly reason: string;
  readonly tokenSuffix: string;

  constructor(input: {
    readonly status?: number | null;
    readonly reason: string;
    readonly token: string;
  }) {
    super(`APNs request failed: ${input.reason}`);
    this.name = "SafeApnsError";
    this.status = input.status ?? null;
    this.reason = sanitizeApnsReason(input.reason);
    this.tokenSuffix = input.token.slice(-8);
  }
}

const APNS_PROVIDER_TOKEN_REUSE_SECONDS = 45 * 60;
const providerTokenCache = new Map<string, { readonly issuedAt: number; readonly jwt: string }>();

function base64Url(value: Uint8Array | string): string {
  return Buffer.from(value).toString("base64url");
}

function privateKeyScalar(privateKey: string): Uint8Array {
  const jwk = NodeCrypto.createPrivateKey(privateKey.replace(/\\n/g, "\n")).export({
    format: "jwk",
  });
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || typeof jwk.d !== "string") {
    throw new Error("APNs signing key must be a PKCS#8 P-256 private key.");
  }
  return Buffer.from(jwk.d, "base64url");
}

export function validateApnsPrivateKey(privateKey: string): void {
  if (!privateKey.includes("-----BEGIN PRIVATE KEY-----")) {
    throw new Error("APNs signing key must use PKCS#8 PEM format.");
  }
  privateKeyScalar(privateKey);
}

export function quantizedApnsJwtIssuedAt(nowUnixSeconds: number): number {
  return (
    Math.floor(nowUnixSeconds / APNS_PROVIDER_TOKEN_REUSE_SECONDS) *
    APNS_PROVIDER_TOKEN_REUSE_SECONDS
  );
}

export function makeApnsProviderJwt(
  credentials: Pick<ApnsCredentials, "teamId" | "keyId" | "privateKey">,
  nowUnixSeconds: number,
): string {
  const issuedAt = quantizedApnsJwtIssuedAt(nowUnixSeconds);
  const fingerprint = NodeCrypto.createHash("sha256")
    .update(credentials.privateKey)
    .digest("hex")
    .slice(0, 16);
  const cacheKey = `${credentials.teamId}:${credentials.keyId}:${fingerprint}`;
  const cached = providerTokenCache.get(cacheKey);
  if (cached?.issuedAt === issuedAt) return cached.jwt;

  const header = base64Url(JSON.stringify({ alg: "ES256", kid: credentials.keyId }));
  const payload = base64Url(JSON.stringify({ iss: credentials.teamId, iat: issuedAt }));
  const signingInput = `${header}.${payload}`;
  const signature = p256
    .sign(
      sha256(new TextEncoder().encode(signingInput)),
      privateKeyScalar(credentials.privateKey),
      {
        prehash: false,
      },
    )
    .toCompactRawBytes();
  const jwt = `${signingInput}.${base64Url(signature)}`;
  providerTokenCache.set(cacheKey, { issuedAt, jwt });
  return jwt;
}

export function resetApnsProviderTokenCacheForTest(): void {
  providerTokenCache.clear();
}

export function apnsHost(environment: ApnsEnvironment): string {
  return environment === "production"
    ? "https://api.push.apple.com"
    : "https://api.sandbox.push.apple.com";
}

const truncate = (value: string, max: number): string => {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
};

export function sanitizeApnsDeepLink(value: string): string {
  const trimmed = value.trim();
  return !trimmed.startsWith("/") || trimmed.startsWith("//") ? "/" : truncate(trimmed, 512);
}

export function makeApnsAlertPayload(
  notification: ApnsNotificationPayload,
): Record<string, unknown> {
  return {
    aps: {
      alert: { title: truncate(notification.title, 120), body: truncate(notification.body, 120) },
      sound: "default",
    },
    environmentId: notification.environmentId,
    threadId: notification.threadId,
    deepLink: sanitizeApnsDeepLink(notification.deepLink),
    ...(notification.phase ? { phase: notification.phase } : {}),
    ...(notification.updatedAt ? { updatedAt: notification.updatedAt } : {}),
  };
}

function sanitizeApnsReason(value: string): string {
  return truncate(value.replace(/[\r\n\t]/g, " "), 120) || "unknown";
}

function responseReason(body: string): string | null {
  if (!body.trim()) return null;
  try {
    const parsed = JSON.parse(body) as { readonly reason?: unknown };
    return typeof parsed.reason === "string"
      ? sanitizeApnsReason(parsed.reason)
      : "invalid_response";
  } catch {
    return "invalid_response";
  }
}

export function makeApnsAlertRequest(input: {
  readonly credentials: ApnsCredentials;
  readonly environment: ApnsEnvironment;
  readonly token: string;
  readonly notification: ApnsNotificationPayload;
  readonly nowUnixSeconds: number;
}) {
  const body = JSON.stringify(makeApnsAlertPayload(input.notification));
  return {
    host: apnsHost(input.environment),
    headers: {
      ":method": "POST",
      ":path": `/3/device/${input.token}`,
      authorization: `bearer ${makeApnsProviderJwt(input.credentials, input.nowUnixSeconds)}`,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-topic": input.credentials.bundleId,
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
    } as const,
    body,
  };
}

export function sendApnsAlert(input: {
  readonly credentials: ApnsCredentials;
  readonly environment: ApnsEnvironment;
  readonly token: string;
  readonly notification: ApnsNotificationPayload;
  readonly nowUnixSeconds: number;
  readonly timeoutMs?: number;
}): Promise<ApnsDeliveryResult> {
  const requestData = makeApnsAlertRequest(input);

  return new Promise((resolve, reject) => {
    const session = NodeHttp2.connect(requestData.host);
    let settled = false;
    const finish = (effect: () => void) => {
      if (settled) return;
      settled = true;
      session.setTimeout(0);
      session.close();
      effect();
    };
    session.setTimeout(input.timeoutMs ?? 15_000, () =>
      finish(() => reject(new SafeApnsError({ reason: "timeout", token: input.token }))),
    );
    session.once("error", (cause) =>
      finish(() =>
        reject(
          new SafeApnsError({ reason: cause.message || "transport_error", token: input.token }),
        ),
      ),
    );
    const request = session.request(requestData.headers);
    let status = 0;
    let apnsId: string | null = null;
    let responseBody = "";
    request.setEncoding("utf8");
    request.on("response", (headers) => {
      status = typeof headers[":status"] === "number" ? headers[":status"] : 0;
      apnsId = typeof headers["apns-id"] === "string" ? headers["apns-id"] : null;
    });
    request.on("data", (chunk: string) => {
      if (responseBody.length < 2_048) responseBody += chunk;
    });
    request.once("error", (cause) =>
      finish(() =>
        reject(
          new SafeApnsError({
            status,
            reason: cause.message || "transport_error",
            token: input.token,
          }),
        ),
      ),
    );
    request.once("end", () =>
      finish(() =>
        resolve({
          ok: status >= 200 && status < 300,
          status,
          reason: responseReason(responseBody),
          apnsId,
        }),
      ),
    );
    request.end(requestData.body);
  });
}

export function isPermanentApnsTokenFailure(status: number, reason: string | null): boolean {
  return (
    status === 410 ||
    reason === "Unregistered" ||
    reason === "BadDeviceToken" ||
    reason === "DeviceTokenNotForTopic" ||
    reason === "TopicDisallowed"
  );
}

export function shouldRetryApnsDelivery(status: number): boolean {
  return status === 429 || status >= 500;
}
