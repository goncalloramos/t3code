# Codex quota custom desktop build

This fork keeps the Codex quota UI on `feature/codex-quota-ui`. Its `main` branch should remain an
unmodified mirror of `pingdotgg/t3code:main`.

The packaged desktop app uses the product name `T3 Code Custom`, the app ID
`com.goncalloramos.t3code-custom`, separate executable names, and user-data directory names.
Production auto-updates are disabled in this build, so an official T3 Code release
cannot replace it. The updater mock remains available to updater tests and local development.

## Refresh after an upstream T3 Code release

```sh
git fetch upstream --prune
git switch main
git merge --ff-only upstream/main
git push origin main
git switch feature/codex-quota-ui
git rebase main
```

Resolve conflicts on the feature branch, then rerun verification. If the branch was already pushed,
update it with `git push --force-with-lease origin feature/codex-quota-ui`.

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
