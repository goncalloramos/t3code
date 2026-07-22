// @effect-diagnostics nodeBuiltinImport:off - Atomic owner-only credential persistence needs Node's chmod and rename primitives.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import {
  DIRECT_AGENT_NOTIFICATION_BUNDLE_ID,
  type DesktopApnsBootstrapCredentials,
  type DesktopApnsConfigurationStatus,
} from "@t3tools/contracts";
import { validateApnsPrivateKey } from "@t3tools/shared/apns";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Electron from "electron";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronSafeStorage from "../electron/ElectronSafeStorage.ts";

const MAX_APNS_KEY_BYTES = 64 * 1024;
const DOCUMENT_VERSION = 1;

interface PersistedApnsCredentials {
  readonly version: 1;
  readonly teamId: string;
  readonly keyId: string;
  readonly bundleId: typeof DIRECT_AGENT_NOTIFICATION_BUNDLE_ID;
  readonly encryptedPrivateKey: string;
}

export class DesktopApnsCredentialsError extends Schema.TaggedErrorClass<DesktopApnsCredentialsError>()(
  "DesktopApnsCredentialsError",
  {
    operation: Schema.Literals([
      "status",
      "select",
      "read",
      "validate",
      "encrypt",
      "decrypt",
      "write",
      "remove",
    ]),
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export class DesktopApnsCredentialsStore extends Context.Service<
  DesktopApnsCredentialsStore,
  {
    readonly status: Effect.Effect<DesktopApnsConfigurationStatus>;
    readonly importCredentials: (input: {
      readonly teamId: string;
      readonly keyId: string;
    }) => Effect.Effect<
      { readonly status: DesktopApnsConfigurationStatus; readonly imported: boolean },
      DesktopApnsCredentialsError
    >;
    readonly remove: Effect.Effect<
      { readonly status: DesktopApnsConfigurationStatus; readonly removed: boolean },
      DesktopApnsCredentialsError
    >;
    readonly loadForBootstrap: Effect.Effect<
      Option.Option<DesktopApnsBootstrapCredentials>,
      DesktopApnsCredentialsError
    >;
  }
>()("@t3tools/desktop/settings/DesktopApnsCredentialsStore") {}

const safeMessage = (cause: unknown, fallback: string): string =>
  cause instanceof Error && cause.message.trim() ? cause.message.slice(0, 240) : fallback;

const parseDocument = (raw: string): PersistedApnsCredentials => {
  const parsed = JSON.parse(raw) as Partial<PersistedApnsCredentials>;
  if (
    parsed.version !== DOCUMENT_VERSION ||
    typeof parsed.teamId !== "string" ||
    typeof parsed.keyId !== "string" ||
    parsed.bundleId !== DIRECT_AGENT_NOTIFICATION_BUNDLE_ID ||
    typeof parsed.encryptedPrivateKey !== "string"
  ) {
    throw new Error("The APNs credential record is invalid.");
  }
  return parsed as PersistedApnsCredentials;
};

export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const safeStorage = yield* ElectronSafeStorage.ElectronSafeStorage;
  const recordPath = NodePath.join(environment.stateDir, "apns-credentials.json");
  const supported = environment.platform === "darwin";

  const encryptionAvailable = safeStorage.isEncryptionAvailable.pipe(
    Effect.orElseSucceed(() => false),
  );

  const readDocument = Effect.tryPromise({
    try: async () => parseDocument(await NodeFSP.readFile(recordPath, "utf8")),
    catch: (cause) =>
      new DesktopApnsCredentialsError({
        operation: "read",
        message: safeMessage(cause, "Could not read APNs credentials."),
        cause,
      }),
  }).pipe(
    Effect.map(Option.some),
    Effect.catch((error) =>
      "cause" in error && (error.cause as NodeJS.ErrnoException | undefined)?.code === "ENOENT"
        ? Effect.succeed(Option.none<PersistedApnsCredentials>())
        : Effect.fail(error),
    ),
  );

  const status = Effect.gen(function* () {
    const available = yield* encryptionAvailable;
    const document = yield* readDocument.pipe(Effect.orElseSucceed(() => Option.none()));
    return {
      supported,
      configured: supported && available && Option.isSome(document),
      teamId: Option.isSome(document) ? document.value.teamId : null,
      keyId: Option.isSome(document) ? document.value.keyId : null,
      bundleId: DIRECT_AGENT_NOTIFICATION_BUNDLE_ID,
      encryptionAvailable: available,
      error: !supported
        ? "Direct APNs credentials are supported only on macOS."
        : !available
          ? "macOS Keychain encryption is unavailable."
          : null,
    } satisfies DesktopApnsConfigurationStatus;
  });

  const loadForBootstrap = Effect.gen(function* () {
    if (!supported || !(yield* encryptionAvailable)) return Option.none();
    const document = yield* readDocument;
    if (Option.isNone(document)) return Option.none();
    const encrypted = yield* Effect.fromResult(
      Encoding.decodeBase64(document.value.encryptedPrivateKey),
    ).pipe(
      Effect.mapError(
        (cause) =>
          new DesktopApnsCredentialsError({
            operation: "decrypt",
            message: "The encrypted APNs key record is invalid.",
            cause,
          }),
      ),
    );
    const privateKey = yield* safeStorage.decryptString(encrypted).pipe(
      Effect.mapError(
        (cause) =>
          new DesktopApnsCredentialsError({
            operation: "decrypt",
            message: "Could not decrypt APNs credentials with macOS Keychain.",
            cause,
          }),
      ),
    );
    yield* Effect.try({
      try: () => validateApnsPrivateKey(privateKey),
      catch: (cause) =>
        new DesktopApnsCredentialsError({
          operation: "validate",
          message: "The stored APNs key is not a valid P-256 private key.",
          cause,
        }),
    });
    return Option.some({
      teamId: document.value.teamId,
      keyId: document.value.keyId,
      bundleId: DIRECT_AGENT_NOTIFICATION_BUNDLE_ID,
      privateKey,
    });
  });

  const importCredentials: DesktopApnsCredentialsStore["Service"]["importCredentials"] = Effect.fn(
    "DesktopApnsCredentialsStore.importCredentials",
  )(function* (input) {
    if (!supported) {
      return yield* new DesktopApnsCredentialsError({
        operation: "select",
        message: "Direct APNs credentials are supported only on macOS.",
      });
    }
    if (!(yield* encryptionAvailable)) {
      return yield* new DesktopApnsCredentialsError({
        operation: "encrypt",
        message: "macOS Keychain encryption is unavailable.",
      });
    }
    const selection = yield* Effect.tryPromise({
      try: () =>
        Electron.dialog.showOpenDialog({
          title: "Choose APNs authentication key",
          properties: ["openFile"],
          filters: [{ name: "APNs authentication key", extensions: ["p8"] }],
        }),
      catch: (cause) =>
        new DesktopApnsCredentialsError({
          operation: "select",
          message: "Could not open the APNs key picker.",
          cause,
        }),
    });
    if (selection.canceled || !selection.filePaths[0]) {
      return { status: yield* status, imported: false };
    }
    const privateKey = yield* Effect.tryPromise({
      try: async () => {
        const filePath = selection.filePaths[0]!;
        const stat = await NodeFSP.stat(filePath);
        if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_APNS_KEY_BYTES) {
          throw new Error("The selected APNs key file has an invalid size.");
        }
        return NodeFSP.readFile(filePath, "utf8");
      },
      catch: (cause) =>
        new DesktopApnsCredentialsError({
          operation: "read",
          message: safeMessage(cause, "Could not read the selected APNs key."),
          cause,
        }),
    });
    yield* Effect.try({
      try: () => validateApnsPrivateKey(privateKey),
      catch: (cause) =>
        new DesktopApnsCredentialsError({
          operation: "validate",
          message: "The selected file must be a PKCS#8 P-256 APNs private key.",
          cause,
        }),
    });
    const encrypted = yield* safeStorage.encryptString(privateKey).pipe(
      Effect.mapError(
        (cause) =>
          new DesktopApnsCredentialsError({
            operation: "encrypt",
            message: "Could not encrypt the APNs key with macOS Keychain.",
            cause,
          }),
      ),
    );
    const document: PersistedApnsCredentials = {
      version: DOCUMENT_VERSION,
      teamId: input.teamId.trim(),
      keyId: input.keyId.trim(),
      bundleId: DIRECT_AGENT_NOTIFICATION_BUNDLE_ID,
      encryptedPrivateKey: Encoding.encodeBase64(encrypted),
    };
    const now = yield* Clock.currentTimeMillis;
    yield* Effect.tryPromise({
      try: async () => {
        await NodeFSP.mkdir(NodePath.dirname(recordPath), { recursive: true, mode: 0o700 });
        const temporaryPath = `${recordPath}.${process.pid}.${now}.tmp`;
        try {
          // @effect-diagnostics-next-line preferSchemaOverJson:off - This is a closed, versioned internal record; parseDocument validates reads.
          await NodeFSP.writeFile(temporaryPath, JSON.stringify(document), {
            mode: 0o600,
            flag: "wx",
          });
          await NodeFSP.chmod(temporaryPath, 0o600);
          await NodeFSP.rename(temporaryPath, recordPath);
          await NodeFSP.chmod(recordPath, 0o600);
        } finally {
          await NodeFSP.rm(temporaryPath, { force: true }).catch(() => undefined);
        }
      },
      catch: (cause) =>
        new DesktopApnsCredentialsError({
          operation: "write",
          message: "Could not save encrypted APNs credentials.",
          cause,
        }),
    });
    return { status: yield* status, imported: true };
  });

  const remove = Effect.gen(function* () {
    const existed = yield* Effect.promise(() =>
      NodeFSP.stat(recordPath)
        .then(() => true)
        .catch(() => false),
    );
    yield* Effect.tryPromise({
      try: () => NodeFSP.rm(recordPath, { force: true }),
      catch: (cause) =>
        new DesktopApnsCredentialsError({
          operation: "remove",
          message: "Could not remove APNs credentials.",
          cause,
        }),
    });
    return { status: yield* status, removed: existed };
  });

  return DesktopApnsCredentialsStore.of({ status, importCredentials, remove, loadForBootstrap });
});

export const layer = Layer.effect(DesktopApnsCredentialsStore, make);
