# AGENTS.md

## Task Completion Requirements

- `vp check` and `vp run typecheck` must pass before considering tasks completed.
  - If changing native mobile code, `vp run lint:mobile` must also pass.
- Use `vp test` for the built-in Vite+ test command and `vp run test` when you specifically need the `test` package script.

## Project Snapshot

T3 Code is a minimal web GUI for using coding agents like Codex and Claude.

This repository is a VERY EARLY WIP. Proposing sweeping changes that improve long-term maintainability is encouraged.

## Core Priorities

1. Performance first.
2. Reliability first.
3. Keep behavior predictable under load and during failures (session restarts, reconnects, partial streams).

If a tradeoff is required, choose correctness and robustness over short-term convenience.

## Maintainability

Long term maintainability is a core priority. If you add new functionality, first check if there is shared logic that can be extracted to a separate module. Duplicate logic across multiple files is a code smell and should be avoided. Don't be afraid to change existing code. Don't take shortcuts by just adding local logic to solve a problem.

## Package Roles

- `apps/server`: Node.js WebSocket server. Wraps Codex app-server (JSON-RPC over stdio), serves the React web app, and manages provider sessions.
- `apps/web`: React/Vite UI. Owns session UX, conversation/event rendering, and client-side state. Connects to the server via WebSocket.
- `packages/contracts`: Shared effect/Schema schemas and TypeScript contracts for provider events, WebSocket protocol, and model/session types. Keep this package schema-only — no runtime logic.
- `packages/shared`: Shared runtime utilities consumed by both server and client applications. Uses explicit subpath exports (e.g. `@t3tools/shared/git`) — no barrel index.
- `packages/client-runtime`: Shared runtime package for sharing client code across web and mobile.

## Reference Repos

- Open-source Codex repo: https://github.com/openai/codex
- Codex-Monitor (Tauri, feature-complete, strong reference implementation): https://github.com/Dimillian/CodexMonitor

Use these as implementation references when designing protocol handling, UX flows, and operational safeguards.

## Vendored Repositories

This project vendors external repositories under `.repos/` as read-only reference material for coding
agents.

- Prefer examples and patterns from the vendored source code over generated guesses or web search results.
- Do not edit files under `.repos/` unless explicitly asked.
- Do not import from `.repos/`; application code must continue importing from normal package dependencies.
- Manage vendored subtrees with `bun run sync:repos`; use `bun run sync:repos --repo <id>` to sync one
  configured repository.
- When updating a dependency with a configured vendored subtree, sync that subtree in the same change so
  `.repos/` matches the installed dependency version.
- When writing Effect code, read `.repos/effect-smol/LLMS.md` first and inspect `.repos/effect-smol/` for
  examples of idiomatic usage, tests, module structure, and API design.
- When writing relay infrastructure code with Alchemy, inspect `.repos/alchemy-effect/` for examples of
  idiomatic usage, tests, module structure, and API design.

## Custom Fork Maintenance

This checkout is a custom desktop distribution of T3 Code. Treat these remotes and branches as
different products:

- `upstream/main`: the official `pingdotgg/t3code` development line. Never push custom commits here.
- `origin/main`: the installable `goncalloramos/t3code` custom release line. It contains upstream plus
  the custom changes below.
- `feature/codex-quota-ui`: the original topic branch and useful historical record of the custom
  commits. New upstream integrations should use a temporary `maintenance/upstream-YYYYMMDD` branch
  from `origin/main`, not rewrite published `main`.

At the time this section was introduced, custom `main` was created by merge commit `ffb975619` from
official base `1735e27d9`. Do not assume those hashes remain current; always calculate the merge base.

### Custom behavior that must survive an upstream update

1. Native Codex quota UI
   - Reads the initial `account/rateLimits/read` snapshot when Codex connects.
   - Merges sparse `account/rateLimits/updated` notifications.
   - Projects schema-backed state through the server contracts to the React client.
   - Shows all available rate-limit buckets and duration-derived window labels in the chat header.
   - Handles loading, unavailable, authentication-error, and expired-data states without exposing
     credentials.
   - Primary files live in `packages/shared/src/codexRateLimits.ts`,
     `packages/contracts/src/providerRuntime.ts`, `packages/contracts/src/server.ts`, the Codex provider
     files under `apps/server/src/provider/`, and `apps/web/src/components/chat/CodexQuotaIndicator.tsx`.
2. Custom desktop identity and isolation
   - Product name: `T3 Code Custom`.
   - App ID: `com.goncalloramos.t3code-custom`.
   - Separate executable, application-data, Linux desktop, and WM-class names.
   - The official updater must stay disabled unless it is deliberately replaced with releases from
     this fork.
   - Unsigned local macOS builds must receive a valid ad-hoc signature after Electron is renamed.
3. Custom visual identity
   - macOS icon uses `assets/custom/t3-custom-macos-1024.png` and includes the `CUSTOM` badge.
   - Stable desktop builds inject stage label `Custom`, so the sidebar reads `T3 Code CUSTOM` while
     the macOS application/menu name remains `T3 Code Custom`.
   - Development and nightly labels remain `Dev` and `Nightly`.
4. Compatibility
   - Claude, Cursor, and OpenCode behavior must remain unchanged.
   - Hosted/web T3 branding must not be globally renamed to the custom desktop branding.

The original logical custom commits are useful during audits:

- `84fa01169`: Codex quota state, utilities, tests, and UI.
- `bfc641f87`: valid ad-hoc signing for local macOS builds.
- `56bdf3fdc`: custom macOS icon.
- `84d6ae2e7`: `Custom` stable desktop/sidebar branding.

### Required upstream-update procedure

Never merge a new upstream release blindly. First start clean and fetch both repositories:

```sh
git status --short --branch
git fetch --prune origin
git fetch --prune upstream
git switch main
git pull --ff-only origin main
BASE=$(git merge-base origin/main upstream/main)
echo "$BASE"
```

Stop if the worktree is dirty or if `main` cannot fast-forward from `origin/main`. Preserve unrelated
user work before continuing.

#### 1. Audit whether upstream already contains our changes

Run all of the following before merging:

```sh
git log --left-right --cherry-pick --oneline upstream/main...origin/main
git cherry -v upstream/main origin/main
git range-diff "$BASE"..origin/main "$BASE"..upstream/main

git diff --name-only "$BASE"..origin/main | sort > /tmp/t3-custom-files.txt
git diff --name-only "$BASE"..upstream/main | sort > /tmp/t3-upstream-files.txt
comm -12 /tmp/t3-custom-files.txt /tmp/t3-upstream-files.txt
```

Interpret the results carefully:

- A `-` entry from `git cherry` means upstream has a patch-equivalent change; do not replay it.
- A shared file path only signals possible overlap, not equivalence.
- `git cherry` cannot detect a feature that upstream implemented differently, so semantic inspection
  is mandatory.

Search the updated upstream tree for the feature concepts, not only our filenames:

```sh
git grep -n -E 'account/rateLimits/(read|updated)|rateLimitsByLimitId|windowDurationMins|usedPercent' upstream/main -- apps packages
git grep -n -E 'CodexQuota|quota|rate.?limit' upstream/main -- apps/web apps/server packages
git grep -n -E 'appId|productName|autoUpdater|stageLabel|T3 Code Custom' upstream/main -- apps/desktop scripts packages/contracts
```

Then inspect upstream changes in every overlapping or semantically related file:

```sh
git diff "$BASE"..upstream/main -- apps/server/src/provider apps/web/src/components/chat packages/contracts packages/shared scripts/build-desktop-artifact.ts
```

Classify each custom area before integration:

- **Upstream fully implements it:** use the upstream implementation and remove our duplicate code,
  while retaining fork-only identity, updater isolation, icon, and branding. Keep or adapt our tests
  to prove the upstream implementation satisfies the custom requirements.
- **Upstream partially implements it:** adopt the new upstream contracts/state architecture and add
  only the missing behavior. Do not maintain parallel rate-limit models or duplicate event flows.
- **Upstream changed the same files for unrelated reasons:** preserve both behaviors and resolve at the
  semantic level.
- **Upstream does not implement it:** retain the custom implementation and adapt it to upstream APIs.

Never resolve a conflict by accepting all of `ours` or all of `theirs` across a file without reviewing
the resulting behavior. Prefer upstream architecture and naming, then reapply only the custom delta.

#### 2. Integrate on a temporary maintenance branch

Create a dated branch from the current custom release line and merge upstream into it:

```sh
git switch -c maintenance/upstream-YYYYMMDD origin/main
git merge --no-ff upstream/main -m "Merge upstream T3 Code update"
```

Resolve conflicts according to the audit. When upstream supersedes part of the custom feature, add a
separate cleanup/adaptation commit so the decision remains visible in history. Review the completed
delta from the new upstream base:

```sh
git diff --stat upstream/main...HEAD
git diff upstream/main...HEAD
git log --oneline --decorate upstream/main..HEAD
```

The final diff should contain only behavior still specific to this fork. Unexpected upstream code in
that diff usually means the merge or conflict resolution is wrong.

#### 3. Verify the merged application

Install dependencies using the package-manager and Node versions declared in the root
`package.json`. Run the required repository checks:

```sh
vp test
vp check
vp run typecheck
```

During conflict resolution, these focused tests provide a quicker signal but do not replace the full
checks:

```sh
vp test run packages/shared/src/codexRateLimits.test.ts apps/web/src/lib/codexQuota.test.ts
vp test run apps/server/src/provider/Layers/CodexAdapter.test.ts
vp test run apps/desktop/src/app/DesktopEnvironment.test.ts scripts/build-desktop-artifact.test.ts
```

Manually verify at least these behaviors:

- Connect Codex and confirm initial quota values appear without waiting for an update notification.
- Confirm sparse notifications update one window without deleting other windows or buckets.
- Open the quota popover and inspect reset times, progress bars, error/loading/expired states, and
  multiple buckets.
- Start sessions for Claude, Cursor, and OpenCode to confirm provider-aware behavior.
- Confirm stable desktop branding says `CUSTOM`, uses the custom icon and app ID, stores data separately,
  and cannot be replaced by the official updater.

Build and validate the installable artifact. On Apple Silicon macOS:

```sh
pnpm run dist:desktop:dmg:arm64
hdiutil verify release/T3-Code-Custom-*-arm64.dmg
```

Mount the DMG and run `codesign --verify --deep --strict` against `T3 Code Custom.app`. Launch the
packaged app and capture a screenshot of the quota indicator/popover and custom branding. If launched
directly from a T3 integrated terminal, remove `ELECTRON_RUN_AS_NODE` for that command; Finder launches
are unaffected.

#### 4. Publish only after verification

Push the maintenance branch first so the integration is recoverable and reviewable:

```sh
git push -u origin maintenance/upstream-YYYYMMDD
```

After review, fast-forward custom `main` and push it:

```sh
git switch main
git merge --ff-only maintenance/upstream-YYYYMMDD
git push origin main
```

Confirm `origin/main` points to the verified commit and record the new `git merge-base origin/main
upstream/main` in the maintenance commit or release notes. Do not force-push `main`, push to
`upstream`, or point the custom updater at `pingdotgg/t3code`.
