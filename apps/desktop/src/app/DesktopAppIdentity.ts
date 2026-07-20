// @effect-diagnostics nodeBuiltinImport:off - Electron identity migration must block the ready event so protocol registration and helper processes cannot race the atomic copy.
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as DesktopAssets from "./DesktopAssets.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import {
  GONCALLORAMOS_PRODUCT_IDENTITY,
  LEGACY_GONCALLORAMOS_PRODUCT_IDENTITY,
} from "../../../../scripts/lib/product-identity.ts";

const COMMIT_HASH_PATTERN = /^[0-9a-f]{7,40}$/i;
const COMMIT_HASH_DISPLAY_LENGTH = 12;

const AppPackageMetadata = Schema.Struct({
  t3codeCommitHash: Schema.optional(Schema.String),
});
const decodeAppPackageMetadata = Schema.decodeEffect(Schema.fromJsonString(AppPackageMetadata));
const DesktopMigrationMarker = Schema.Struct({ version: Schema.Number, sourcePath: Schema.String });
const encodeDesktopMigrationMarker = Schema.encodeEffect(
  Schema.fromJsonString(DesktopMigrationMarker),
);

export const isTransientRuntimeMigrationPath = (relativePath: string): boolean => {
  const normalized = relativePath.replaceAll("\\", "/");
  const basename = normalized.slice(normalized.lastIndexOf("/") + 1);
  return (
    normalized === "ssh-launch" ||
    normalized.startsWith("ssh-launch/") ||
    basename === "server-runtime.json" ||
    /(?:^|[._-])(?:pid|sock|socket|lock)$/iu.test(basename) ||
    (/ssh/iu.test(basename) && /forward/iu.test(basename))
  );
};

export class DesktopUserDataPathResolutionError extends Schema.TaggedErrorClass<DesktopUserDataPathResolutionError>()(
  "DesktopUserDataPathResolutionError",
  {
    legacyPath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to inspect legacy desktop user-data path at "${this.legacyPath}".`;
  }
}

export class DesktopIdentityMigrationError extends Schema.TaggedErrorClass<DesktopIdentityMigrationError>()(
  "DesktopIdentityMigrationError",
  {
    sourcePath: Schema.String,
    targetPath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to migrate T3 Code data from "${this.sourcePath}" to "${this.targetPath}". The source was left unchanged.`;
  }
}

const copyDirectoryAtomicallyBeforeReady = (input: {
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly removeTransientRuntimeState: boolean;
}): void => {
  if (NodeFS.existsSync(input.targetPath) || !NodeFS.existsSync(input.sourcePath)) {
    return;
  }

  const temporaryPath = `${input.targetPath}.migrating-${process.pid}`;
  try {
    NodeFS.rmSync(temporaryPath, { recursive: true, force: true });
    NodeFS.cpSync(input.sourcePath, temporaryPath, {
      recursive: true,
      preserveTimestamps: true,
      errorOnExist: true,
      filter: input.removeTransientRuntimeState
        ? (sourcePath) => {
            const relativePath = NodePath.relative(input.sourcePath, sourcePath);
            return relativePath.length === 0 || !isTransientRuntimeMigrationPath(relativePath);
          }
        : undefined,
    });
    NodeFS.writeFileSync(
      NodePath.join(temporaryPath, ".goncalloramos-migration.json"),
      `${JSON.stringify({ version: 1, sourcePath: input.sourcePath })}\n`,
    );
    NodeFS.renameSync(temporaryPath, input.targetPath);
  } catch (cause) {
    NodeFS.rmSync(temporaryPath, { recursive: true, force: true });
    throw new DesktopIdentityMigrationError({
      sourcePath: input.sourcePath,
      targetPath: input.targetPath,
      cause,
    });
  }
};

export const migrateDesktopIdentityBeforeReady = (input: {
  readonly homeDirectory: string;
  readonly platform: NodeJS.Platform;
  readonly isDevelopment: boolean;
  readonly t3HomeOverride: string | undefined;
  readonly appDataDirectoryOverride: string | undefined;
  readonly xdgConfigHomeOverride: string | undefined;
}): string => {
  const appDataDirectory =
    input.platform === "win32"
      ? (input.appDataDirectoryOverride ?? NodePath.join(input.homeDirectory, "AppData", "Roaming"))
      : input.platform === "darwin"
        ? NodePath.join(input.homeDirectory, "Library", "Application Support")
        : (input.xdgConfigHomeOverride ?? NodePath.join(input.homeDirectory, ".config"));
  const userDataDirName = input.isDevelopment
    ? `${GONCALLORAMOS_PRODUCT_IDENTITY.applicationSupportDirectoryName} (Dev)`
    : GONCALLORAMOS_PRODUCT_IDENTITY.applicationSupportDirectoryName;
  const userDataPath = NodePath.join(appDataDirectory, userDataDirName);
  const legacyUserDataPaths = input.isDevelopment
    ? [NodePath.join(appDataDirectory, "T3 Code Custom (Dev)")]
    : LEGACY_GONCALLORAMOS_PRODUCT_IDENTITY.applicationSupportDirectoryNames.map((name) =>
        NodePath.join(appDataDirectory, name),
      );

  if (!NodeFS.existsSync(userDataPath)) {
    const legacyUserDataPath = legacyUserDataPaths.find(NodeFS.existsSync);
    if (legacyUserDataPath !== undefined) {
      copyDirectoryAtomicallyBeforeReady({
        sourcePath: legacyUserDataPath,
        targetPath: userDataPath,
        removeTransientRuntimeState: false,
      });
    }
  }

  if (input.t3HomeOverride === undefined) {
    copyDirectoryAtomicallyBeforeReady({
      sourcePath: NodePath.join(input.homeDirectory, ".t3"),
      targetPath: NodePath.join(
        input.homeDirectory,
        GONCALLORAMOS_PRODUCT_IDENTITY.runtimeHomeDirectoryName,
      ),
      removeTransientRuntimeState: true,
    });
  }

  return userDataPath;
};

const copyDirectoryAtomically = Effect.fn("desktop.appIdentity.copyDirectoryAtomically")(function* (
  environment: DesktopEnvironment.DesktopEnvironment["Service"],
  input: {
    readonly sourcePath: string;
    readonly targetPath: string;
    readonly removeTransientRuntimeState: boolean;
  },
) {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* Effect.gen(function* () {
    if (yield* fileSystem.exists(input.targetPath)) return;
    if (!(yield* fileSystem.exists(input.sourcePath))) return;

    const temporaryPath = `${input.targetPath}.migrating-${process.pid}`;
    yield* fileSystem.remove(temporaryPath, { recursive: true, force: true });
    yield* fileSystem.copy(input.sourcePath, temporaryPath, {
      overwrite: false,
      preserveTimestamps: true,
    });

    if (input.removeTransientRuntimeState) {
      const transientPaths = (yield* fileSystem.readDirectory(temporaryPath, {
        recursive: true,
      }))
        .filter(isTransientRuntimeMigrationPath)
        .sort((left, right) => right.length - left.length)
        .map((relativePath) => environment.path.join(temporaryPath, relativePath));
      yield* Effect.forEach(
        transientPaths,
        (path) => fileSystem.remove(path, { recursive: true, force: true }),
        { discard: true },
      );
    }

    const marker = yield* encodeDesktopMigrationMarker({
      version: 1,
      sourcePath: input.sourcePath,
    });
    yield* fileSystem.writeFileString(
      environment.path.join(temporaryPath, ".goncalloramos-migration.json"),
      `${marker}\n`,
    );
    yield* fileSystem.rename(temporaryPath, input.targetPath);
  }).pipe(
    Effect.mapError(
      (cause) =>
        new DesktopIdentityMigrationError({
          sourcePath: input.sourcePath,
          targetPath: input.targetPath,
          cause,
        }),
    ),
  );
});

export const migrateDefaultRuntimeHome = (
  environment: DesktopEnvironment.DesktopEnvironment["Service"],
): Effect.Effect<void, DesktopIdentityMigrationError, FileSystem.FileSystem> =>
  environment.shouldMigrateRuntimeHome
    ? copyDirectoryAtomically(environment, {
        sourcePath: environment.legacyBaseDir,
        targetPath: environment.baseDir,
        removeTransientRuntimeState: true,
      })
    : Effect.void;

export const resolveMigratedUserDataPath = (
  environment: DesktopEnvironment.DesktopEnvironment["Service"],
): Effect.Effect<
  string,
  DesktopUserDataPathResolutionError | DesktopIdentityMigrationError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const targetPath = environment.path.join(
      environment.appDataDirectory,
      environment.userDataDirName,
    );
    if (
      yield* fileSystem
        .exists(targetPath)
        .pipe(
          Effect.mapError(
            (cause) => new DesktopUserDataPathResolutionError({ legacyPath: targetPath, cause }),
          ),
        )
    ) {
      return targetPath;
    }

    const legacyPaths = environment.isDevelopment
      ? [environment.path.join(environment.appDataDirectory, environment.legacyUserDataDirName)]
      : LEGACY_GONCALLORAMOS_PRODUCT_IDENTITY.applicationSupportDirectoryNames.map((name) =>
          environment.path.join(environment.appDataDirectory, name),
        );
    let legacyPath: string | null = null;
    for (const candidate of legacyPaths) {
      const exists = yield* fileSystem
        .exists(candidate)
        .pipe(
          Effect.mapError(
            (cause) => new DesktopUserDataPathResolutionError({ legacyPath: candidate, cause }),
          ),
        );
      if (exists) {
        legacyPath = candidate;
        break;
      }
    }
    if (legacyPath === null) return targetPath;
    yield* copyDirectoryAtomically(environment, {
      sourcePath: legacyPath,
      targetPath,
      removeTransientRuntimeState: false,
    });
    return targetPath;
  }).pipe(Effect.withSpan("desktop.appIdentity.resolveUserDataPath"));

export class DesktopAppIdentity extends Context.Service<
  DesktopAppIdentity,
  {
    readonly resolveUserDataPath: Effect.Effect<
      string,
      DesktopUserDataPathResolutionError | DesktopIdentityMigrationError
    >;
    readonly migrateRuntimeHome: Effect.Effect<void, DesktopIdentityMigrationError>;
    readonly configure: Effect.Effect<void>;
  }
>()("@t3tools/desktop/app/DesktopAppIdentity") {}

const normalizeCommitHash = (value: string): Option.Option<string> => {
  const trimmed = value.trim();
  return COMMIT_HASH_PATTERN.test(trimmed)
    ? Option.some(trimmed.slice(0, COMMIT_HASH_DISPLAY_LENGTH).toLowerCase())
    : Option.none();
};

export const make = Effect.gen(function* () {
  const assets = yield* DesktopAssets.DesktopAssets;
  const electronApp = yield* ElectronApp.ElectronApp;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const commitHashCache = yield* Ref.make<Option.Option<Option.Option<string>>>(Option.none());

  const resolveEmbeddedCommitHash = Effect.gen(function* () {
    const packageJsonPath = environment.path.join(environment.appRoot, "package.json");
    const raw = yield* fileSystem.readFileString(packageJsonPath).pipe(Effect.option);
    return yield* Option.match(raw, {
      onNone: () => Effect.succeed(Option.none<string>()),
      onSome: (value) =>
        decodeAppPackageMetadata(value).pipe(
          Effect.map((parsed) =>
            Option.fromNullishOr(parsed.t3codeCommitHash).pipe(Option.flatMap(normalizeCommitHash)),
          ),
          Effect.orElseSucceed(() => Option.none<string>()),
        ),
    });
  });

  const resolveAboutCommitHash = Effect.gen(function* () {
    const cached = yield* Ref.get(commitHashCache);
    if (Option.isSome(cached)) {
      return cached.value;
    }

    const override = Option.flatMap(environment.commitHashOverride, normalizeCommitHash);
    if (Option.isSome(override)) {
      yield* Ref.set(commitHashCache, Option.some(override));
      return override;
    }

    if (!environment.isPackaged) {
      const empty = Option.none<string>();
      yield* Ref.set(commitHashCache, Option.some(empty));
      return empty;
    }

    const commitHash = yield* resolveEmbeddedCommitHash;
    yield* Ref.set(commitHashCache, Option.some(commitHash));
    return commitHash;
  });

  const resolveUserDataPath = resolveMigratedUserDataPath(environment).pipe(
    Effect.provideService(FileSystem.FileSystem, fileSystem),
  );

  const migrateRuntimeHome = migrateDefaultRuntimeHome(environment).pipe(
    Effect.provideService(FileSystem.FileSystem, fileSystem),
    Effect.withSpan("desktop.appIdentity.migrateRuntimeHome"),
  );

  const configure = Effect.gen(function* () {
    const commitHash = yield* resolveAboutCommitHash;
    yield* electronApp.setName(environment.displayName);
    yield* electronApp.setAboutPanelOptions({
      applicationName: environment.displayName,
      applicationVersion: environment.appVersion,
      version: Option.getOrElse(commitHash, () => "unknown"),
    });

    if (environment.platform === "win32") {
      yield* electronApp.setAppUserModelId(environment.appUserModelId);
    }

    if (environment.platform === "linux") {
      yield* electronApp.setDesktopName(environment.linuxDesktopEntryName);
    }

    if (environment.platform === "darwin") {
      const iconPaths = yield* assets.iconPaths;
      yield* Option.match(iconPaths.png, {
        onNone: () => Effect.void,
        onSome: electronApp.setDockIcon,
      });
    }
  }).pipe(Effect.withSpan("desktop.appIdentity.configure"));

  return DesktopAppIdentity.of({
    resolveUserDataPath,
    migrateRuntimeHome,
    configure,
  });
});

export const layer = Layer.effect(DesktopAppIdentity, make);
