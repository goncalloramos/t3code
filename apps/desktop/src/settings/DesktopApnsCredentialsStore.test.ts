// @effect-diagnostics nodeBuiltinImport:off - Test fixtures generate local PKCS#8 keys.
import * as NodeCrypto from "node:crypto";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { beforeEach, vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronSafeStorage from "../electron/ElectronSafeStorage.ts";
import * as DesktopApnsCredentialsStore from "./DesktopApnsCredentialsStore.ts";

const dialogState = vi.hoisted(() => ({ filePath: "" }));

vi.mock("electron", () => ({
  dialog: {
    showOpenDialog: vi.fn(() =>
      Promise.resolve({ canceled: false, filePaths: [dialogState.filePath] }),
    ),
  },
}));

const p256Key = NodeCrypto.generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
}).privateKey;

const wrongCurveKey = NodeCrypto.generateKeyPairSync("ec", {
  namedCurve: "secp384r1",
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
}).privateKey;

const safeStorageLayer = Layer.succeed(ElectronSafeStorage.ElectronSafeStorage, {
  isEncryptionAvailable: Effect.succeed(true),
  encryptString: (value) => Effect.succeed(new TextEncoder().encode(`protected:${value}`)),
  decryptString: (value) =>
    Effect.succeed(new TextDecoder().decode(value).replace(/^protected:/, "")),
} as ElectronSafeStorage.ElectronSafeStorage["Service"]);

const withStore = <A, E, R>(
  effect: Effect.Effect<A, E, R | DesktopApnsCredentialsStore.DesktopApnsCredentialsStore>,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const stateDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-apns-store-test-" });
    const keyPath = `${stateDir}/AuthKey_TEST.p8`;
    dialogState.filePath = keyPath;
    yield* fileSystem.writeFileString(keyPath, p256Key);
    const environmentLayer = Layer.succeed(DesktopEnvironment.DesktopEnvironment, {
      platform: "darwin",
      stateDir,
    } as DesktopEnvironment.DesktopEnvironment["Service"]);
    return yield* effect.pipe(
      Effect.provide(
        DesktopApnsCredentialsStore.layer.pipe(
          Layer.provideMerge(environmentLayer),
          Layer.provideMerge(safeStorageLayer),
        ),
      ),
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

describe("DesktopApnsCredentialsStore", () => {
  beforeEach(() => {
    dialogState.filePath = "";
  });

  it.effect("encrypts the P-256 key at rest and decrypts it only for bootstrap", () =>
    withStore(
      Effect.gen(function* () {
        const store = yield* DesktopApnsCredentialsStore.DesktopApnsCredentialsStore;
        const result = yield* store.importCredentials({
          teamId: "TEAM123456",
          keyId: "KEY1234567",
        });
        assert.isTrue(result.imported);
        assert.isTrue(result.status.configured);

        const fileSystem = yield* FileSystem.FileSystem;
        const environment = yield* DesktopEnvironment.DesktopEnvironment;
        const persisted = yield* fileSystem.readFileString(
          `${environment.stateDir}/apns-credentials.json`,
        );
        assert.notInclude(persisted, p256Key);
        assert.notInclude(persisted, "BEGIN PRIVATE KEY");

        const bootstrap = yield* store.loadForBootstrap;
        assert.isTrue(Option.isSome(bootstrap));
        assert.equal(Option.getOrThrow(bootstrap).privateKey, p256Key);
      }),
    ),
  );

  it.effect("rejects an APNs key using the wrong elliptic curve", () =>
    withStore(
      Effect.gen(function* () {
        const store = yield* DesktopApnsCredentialsStore.DesktopApnsCredentialsStore;
        const fileSystem = yield* FileSystem.FileSystem;
        yield* fileSystem.writeFileString(dialogState.filePath, wrongCurveKey);
        const error = yield* Effect.flip(
          store.importCredentials({ teamId: "TEAM123456", keyId: "KEY1234567" }),
        );
        assert.equal(error.operation, "validate");
        assert.match(error.message, /P-256/);
      }),
    ),
  );
});
