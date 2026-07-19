# Codex quota custom desktop build

This fork ships the Codex quota UI and custom desktop identity from its `main` branch. The official
T3 Code development line is tracked separately as `upstream/main`; custom commits must never be
pushed to that remote.

The packaged desktop app uses the product name `T3 Code Custom`, the app ID
`com.goncalloramos.t3code-custom`, separate executable names, and user-data directory names.
Production auto-updates are disabled in this build, so an official T3 Code release
cannot replace it. The updater mock remains available to updater tests and local development.

## Refresh after an upstream T3 Code release

Follow **Custom Fork Maintenance** in the repository root `AGENTS.md`. That procedure is canonical. It
requires comparing patch-equivalent commits, changed-file overlap, and semantic feature concepts
before merging upstream. This prevents replaying custom quota code when upstream has implemented the
same behavior under different files or APIs.

Integrate on a temporary `maintenance/upstream-YYYYMMDD` branch from `origin/main`, verify it, and only
then fast-forward the fork's `main`. Never force-push `main`.

## Verify

Install dependencies with the package-manager version declared in the root `package.json`, then run:

```sh
vp test
vp check
vp run typecheck
```

For a quicker quota-focused pass while resolving a rebase:

```sh
vp test run packages/shared/src/codexRateLimits.test.ts apps/web/src/lib/codexQuota.test.ts
```

## Rebuild the desktop app

Use the repository build command for the target platform. For example, on Apple Silicon macOS:

```sh
pnpm run dist:desktop:dmg:arm64
```

Do not set `T3CODE_DESKTOP_UPDATE_REPOSITORY` to `pingdotgg/t3code`. Auto-updates are disabled for
this custom build, but custom releases should still be published only from this fork.
