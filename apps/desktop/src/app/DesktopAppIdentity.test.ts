import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";

import type * as Electron from "electron";

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as DesktopAppIdentity from "./DesktopAppIdentity.ts";
import * as DesktopAssets from "./DesktopAssets.ts";
import * as DesktopConfig from "./DesktopConfig.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";

const defaultEnvironmentInput = {
  dirname: "/repo/apps/desktop/dist-electron",
  homeDirectory: "/Users/alice",
  platform: "darwin",
  processArch: "arm64",
  appVersion: "1.2.3",
  appPath: "/Applications/T3 Code.app/Contents/Resources/app.asar",
  isPackaged: true,
  resourcesPath: "/Applications/T3 Code.app/Contents/Resources",
  runningUnderArm64Translation: false,
} satisfies DesktopEnvironment.MakeDesktopEnvironmentInput;

type TestEnvironmentInput = Partial<DesktopEnvironment.MakeDesktopEnvironmentInput> & {
  readonly env?: Record<string, string | undefined>;
};

interface ElectronAppCalls {
  readonly setAboutPanelOptions: Array<Electron.AboutPanelOptionsOptions>;
  readonly setDockIcon: string[];
  readonly setName: string[];
}

const makeElectronAppLayer = (calls: ElectronAppCalls) =>
  Layer.succeed(ElectronApp.ElectronApp, {
    metadata: Effect.die("unexpected metadata read"),
    name: Effect.succeed("T3 Code"),
    whenReady: Effect.void,
    quit: Effect.void,
    exit: () => Effect.void,
    relaunch: () => Effect.void,
    setPath: () => Effect.void,
    setName: (name) =>
      Effect.sync(() => {
        calls.setName.push(name);
      }),
    setAboutPanelOptions: (options) =>
      Effect.sync(() => {
        calls.setAboutPanelOptions.push(options);
      }),
    setAppUserModelId: () => Effect.void,
    requestSingleInstanceLock: Effect.succeed(true),
    isDefaultProtocolClient: () => Effect.succeed(false),
    setAsDefaultProtocolClient: () => Effect.succeed(true),
    setDesktopName: () => Effect.void,
    setDockIcon: (iconPath) =>
      Effect.sync(() => {
        calls.setDockIcon.push(iconPath);
      }),
    getLoginItemSettings: Effect.succeed({ openAtLogin: false } as Electron.LoginItemSettings),
    setLoginItemSettings: () => Effect.void,
    appendCommandLineSwitch: () => Effect.void,
    on: () => Effect.void,
  } satisfies ElectronApp.ElectronApp["Service"]);

const makeAssetsLayer = (png: Option.Option<string>) =>
  Layer.succeed(DesktopAssets.DesktopAssets, {
    iconPaths: Effect.succeed({
      ico: Option.none(),
      icns: Option.none(),
      png,
    }),
    resolveResourcePath: () => Effect.succeed(Option.none()),
  } satisfies DesktopAssets.DesktopAssets["Service"]);

const makeEnvironmentLayer = (overrides: TestEnvironmentInput = {}) => {
  const { env, ...environmentOverrides } = overrides;
  return DesktopEnvironment.layer({
    ...defaultEnvironmentInput,
    ...environmentOverrides,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(
        NodeServices.layer,
        DesktopConfig.layerTest({
          ...env,
        }),
      ),
    ),
  );
};

const withIdentity = <A, E, R>(
  effect: Effect.Effect<
    A,
    E,
    | R
    | DesktopAppIdentity.DesktopAppIdentity
    | DesktopEnvironment.DesktopEnvironment
    | FileSystem.FileSystem
  >,
  input: {
    readonly calls?: ElectronAppCalls;
    readonly environment?: TestEnvironmentInput;
    readonly legacyPathExists?: boolean;
    readonly legacyPathProbeError?: PlatformError.PlatformError;
    readonly targetPathExists?: boolean;
    readonly useRealFileSystem?: boolean;
    readonly packageJson?: string;
    readonly pngIconPath?: Option.Option<string>;
  } = {},
) => {
  const calls: ElectronAppCalls = input.calls ?? {
    setAboutPanelOptions: [],
    setDockIcon: [],
    setName: [],
  };

  return effect.pipe(
    Effect.provide(
      DesktopAppIdentity.layer.pipe(
        Layer.provideMerge(
          input.useRealFileSystem
            ? NodeServices.layer
            : FileSystem.layerNoop({
                exists: (path) =>
                  input.legacyPathProbeError && path.includes("T3 Code Custom")
                    ? Effect.fail(input.legacyPathProbeError)
                    : Effect.succeed(
                        (input.targetPathExists === true &&
                          path.includes("T3 Code - goncalloramos")) ||
                          (input.legacyPathExists === true && path.includes("T3 Code Custom")),
                      ),
                readFileString: () =>
                  Effect.succeed(input.packageJson ?? '{"t3codeCommitHash":"abcdef1234567890"}'),
                copy: () => Effect.void,
                remove: () => Effect.void,
                rename: () => Effect.void,
                writeFileString: () => Effect.void,
              }),
        ),
        Layer.provideMerge(makeAssetsLayer(input.pngIconPath ?? Option.none())),
        Layer.provideMerge(makeElectronAppLayer(calls)),
        Layer.provideMerge(makeEnvironmentLayer(input.environment)),
      ),
    ),
  );
};

describe("DesktopAppIdentity", () => {
  it("classifies only transient runtime state for exclusion", () => {
    assert.isTrue(DesktopAppIdentity.isTransientRuntimeMigrationPath("userdata/server.pid"));
    assert.isTrue(
      DesktopAppIdentity.isTransientRuntimeMigrationPath("userdata/server-runtime.json"),
    );
    assert.isTrue(
      DesktopAppIdentity.isTransientRuntimeMigrationPath("ssh-launch/forward-record.json"),
    );
    assert.isFalse(DesktopAppIdentity.isTransientRuntimeMigrationPath("userdata/state.sqlite"));
    assert.isFalse(
      DesktopAppIdentity.isTransientRuntimeMigrationPath("attachments/design.lockup.png"),
    );
  });

  it.effect("migrates the legacy userData path into the new destination", () =>
    withIdentity(
      Effect.gen(function* () {
        const identity = yield* DesktopAppIdentity.DesktopAppIdentity;
        const userDataPath = yield* identity.resolveUserDataPath;

        assert.equal(
          userDataPath,
          "/Users/alice/Library/Application Support/T3 Code - goncalloramos",
        );
      }),
      { legacyPathExists: true },
    ),
  );

  it.effect("copies a real legacy profile atomically and retains the source", () => {
    const homeDirectory = `/tmp/t3-goncalloramos-migration-${process.pid}`;
    const appDataDirectory = `${homeDirectory}/Library/Application Support`;
    const legacyPath = `${appDataDirectory}/T3 Code Custom`;
    const targetPath = `${appDataDirectory}/T3 Code - goncalloramos`;

    return withIdentity(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        yield* fileSystem.remove(homeDirectory, { recursive: true, force: true });
        yield* fileSystem.makeDirectory(legacyPath, { recursive: true });
        yield* fileSystem.writeFileString(`${legacyPath}/profile.json`, '{"kept":true}\n');
        const identity = yield* DesktopAppIdentity.DesktopAppIdentity;
        assert.equal(yield* identity.resolveUserDataPath, targetPath);
        assert.equal(
          yield* fileSystem.readFileString(`${targetPath}/profile.json`),
          '{"kept":true}\n',
        );
        assert.equal(
          yield* fileSystem.readFileString(`${legacyPath}/profile.json`),
          '{"kept":true}\n',
        );
        assert.include(
          yield* fileSystem.readFileString(`${targetPath}/.goncalloramos-migration.json`),
          legacyPath,
        );
        yield* fileSystem.writeFileString(`${legacyPath}/profile.json`, '{"kept":false}\n');
        assert.equal(yield* identity.resolveUserDataPath, targetPath);
        assert.equal(
          yield* fileSystem.readFileString(`${targetPath}/profile.json`),
          '{"kept":true}\n',
        );
      }).pipe(
        Effect.ensuring(
          FileSystem.FileSystem.use((fileSystem) =>
            fileSystem.remove(homeDirectory, { recursive: true, force: true }).pipe(Effect.ignore),
          ),
        ),
      ),
      { environment: { homeDirectory }, useRealFileSystem: true },
    );
  });

  it.effect("copies durable runtime state while excluding transient process records", () => {
    const homeDirectory = `/tmp/t3-goncalloramos-runtime-migration-${process.pid}`;
    const legacyPath = `${homeDirectory}/.t3`;
    const targetPath = `${homeDirectory}/.t3-goncalloramos`;

    return withIdentity(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        yield* fileSystem.remove(homeDirectory, { recursive: true, force: true });
        yield* fileSystem.makeDirectory(`${legacyPath}/userdata`, { recursive: true });
        yield* fileSystem.makeDirectory(`${legacyPath}/attachments`, { recursive: true });
        yield* fileSystem.makeDirectory(`${legacyPath}/ssh-launch`, { recursive: true });
        yield* fileSystem.writeFileString(`${legacyPath}/userdata/state.sqlite`, "database");
        yield* fileSystem.writeFileString(`${legacyPath}/attachments/design.png`, "attachment");
        yield* fileSystem.writeFileString(`${legacyPath}/userdata/server-runtime.json`, "runtime");
        yield* fileSystem.writeFileString(`${legacyPath}/userdata/server.pid`, "123");
        yield* fileSystem.writeFileString(`${legacyPath}/ssh-launch/forward-record.json`, "stale");

        const identity = yield* DesktopAppIdentity.DesktopAppIdentity;
        yield* identity.migrateRuntimeHome;

        assert.isTrue(yield* fileSystem.exists(`${targetPath}/userdata/state.sqlite`));
        assert.isTrue(yield* fileSystem.exists(`${targetPath}/attachments/design.png`));
        assert.isFalse(yield* fileSystem.exists(`${targetPath}/userdata/server-runtime.json`));
        assert.isFalse(yield* fileSystem.exists(`${targetPath}/userdata/server.pid`));
        assert.isFalse(yield* fileSystem.exists(`${targetPath}/ssh-launch`));
        assert.isTrue(yield* fileSystem.exists(`${legacyPath}/userdata/server-runtime.json`));
      }).pipe(
        Effect.ensuring(
          FileSystem.FileSystem.use((fileSystem) =>
            fileSystem.remove(homeDirectory, { recursive: true, force: true }).pipe(Effect.ignore),
          ),
        ),
      ),
      { environment: { homeDirectory }, useRealFileSystem: true },
    );
  });

  it.effect("finishes both migrations synchronously before Electron can become ready", () => {
    const homeDirectory = `/tmp/t3-goncalloramos-early-migration-${process.pid}`;
    const appDataDirectory = `${homeDirectory}/Library/Application Support`;
    const legacyProfilePath = `${appDataDirectory}/t3code-custom`;
    const targetProfilePath = `${appDataDirectory}/T3 Code - goncalloramos`;
    const legacyRuntimePath = `${homeDirectory}/.t3`;
    const targetRuntimePath = `${homeDirectory}/.t3-goncalloramos`;

    return FileSystem.FileSystem.use((fileSystem) =>
      Effect.gen(function* () {
        yield* fileSystem.remove(homeDirectory, { recursive: true, force: true });
        yield* fileSystem.makeDirectory(legacyProfilePath, { recursive: true });
        yield* fileSystem.makeDirectory(`${legacyRuntimePath}/userdata`, { recursive: true });
        yield* fileSystem.writeFileString(`${legacyProfilePath}/profile.json`, "profile");
        yield* fileSystem.writeFileString(`${legacyRuntimePath}/userdata/state.sqlite`, "database");
        yield* fileSystem.writeFileString(
          `${legacyRuntimePath}/userdata/server-runtime.json`,
          "stale",
        );

        const userDataPath = DesktopAppIdentity.migrateDesktopIdentityBeforeReady({
          homeDirectory,
          platform: "darwin",
          isDevelopment: false,
          t3HomeOverride: undefined,
          appDataDirectoryOverride: undefined,
          xdgConfigHomeOverride: undefined,
        });

        assert.equal(userDataPath, targetProfilePath);
        assert.isTrue(yield* fileSystem.exists(`${targetProfilePath}/profile.json`));
        assert.isTrue(yield* fileSystem.exists(`${targetRuntimePath}/userdata/state.sqlite`));
        assert.isFalse(
          yield* fileSystem.exists(`${targetRuntimePath}/userdata/server-runtime.json`),
        );
        assert.isTrue(
          yield* fileSystem.exists(`${legacyRuntimePath}/userdata/server-runtime.json`),
        );
      }).pipe(
        Effect.ensuring(
          fileSystem.remove(homeDirectory, { recursive: true, force: true }).pipe(Effect.ignore),
        ),
      ),
    ).pipe(Effect.provide(NodeServices.layer));
  });

  it.effect("preserves failures while inspecting the legacy userData path", () => {
    const legacyPath = "/Users/alice/Library/Application Support/T3 Code Custom";
    const cause = PlatformError.systemError({
      _tag: "PermissionDenied",
      module: "FileSystem",
      method: "exists",
      description: "permission denied",
      pathOrDescriptor: legacyPath,
    });

    return withIdentity(
      Effect.gen(function* () {
        const identity = yield* DesktopAppIdentity.DesktopAppIdentity;
        const error = yield* identity.resolveUserDataPath.pipe(Effect.flip);

        assert.instanceOf(error, DesktopAppIdentity.DesktopUserDataPathResolutionError);
        assert.equal(error.legacyPath, legacyPath);
        assert.strictEqual(error.cause, cause);
        assert.equal(
          error.message,
          `Failed to inspect legacy desktop user-data path at "${legacyPath}".`,
        );
      }),
      { legacyPathProbeError: cause },
    );
  });

  it.effect("configures app identity from the environment commit override", () => {
    const calls: ElectronAppCalls = {
      setAboutPanelOptions: [],
      setDockIcon: [],
      setName: [],
    };

    return withIdentity(
      Effect.gen(function* () {
        const identity = yield* DesktopAppIdentity.DesktopAppIdentity;
        yield* identity.configure;

        assert.deepEqual(calls.setName, ["T3 Code - goncalloramos"]);
        assert.equal(calls.setAboutPanelOptions[0]?.applicationName, "T3 Code - goncalloramos");
        assert.equal(calls.setAboutPanelOptions[0]?.applicationVersion, "1.2.3");
        assert.equal(calls.setAboutPanelOptions[0]?.version, "0123456789ab");
        assert.deepEqual(calls.setDockIcon, ["/icon.png"]);
      }),
      {
        calls,
        environment: {
          env: {
            T3CODE_COMMIT_HASH: "0123456789abcdef",
          },
        },
        pngIconPath: Option.some("/icon.png"),
      },
    );
  });
});
