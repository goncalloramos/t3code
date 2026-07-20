# T3 Code - goncalloramos Remote Mode

Remote Mode provides private foreground control of the desktop-hosted T3 environment from the
goncalloramos iPhone build. It reuses the normal provider-neutral T3 protocol, so Codex, Claude,
Cursor, and OpenCode share the same pairing, thread, approval, terminal, file, diff, and reconnect
workflow.

## Desktop setup

1. Install Tailscale on the Mac and iPhone, sign both into the same tailnet, and enable MagicDNS.
2. In **Settings → Connections**, turn on **Remote Mode**.
3. Leave **Prevent Mac sleep** and **Launch at login** enabled unless you have another uptime plan.
4. Wait for the verified `https://<mac>.<tailnet>.ts.net/` endpoint, then create a pairing link from
   the Authorized clients section and scan its QR code on the iPhone.

The backend remains bound to `127.0.0.1`. Tailscale Serve terminates private HTTPS on port 443 and
proxies to that loopback backend. Remote Mode never enables Tailscale Funnel. Disabling Remote Mode
removes the T3-owned Serve mapping, releases the scoped sleep assertion, and removes the login item
created for Remote Mode without deleting paired-client records.

The desktop data target is `~/Library/Application Support/T3 Code - goncalloramos`; first launch
copies `T3 Code Custom` (then `t3code-custom`) when the new destination does not exist. The old
directory is retained. The runtime target is `~/.t3-goncalloramos`; durable data is copied from
`~/.t3`, while PID, socket, lock, runtime, and SSH-forward records are excluded. `~/.t3` remains a
rollback backup.

## Private iPhone build

Supply a paid Apple Developer team and build the isolated variant:

```sh
T3CODE_APPLE_TEAM_ID=YOURTEAMID APP_VARIANT=goncalloramos pnpm --filter @t3tools/mobile ios:goncalloramos
```

The build is named `T3 Code - goncalloramos`, uses bundle ID
`com.goncalloramos.t3code.mobile`, app group `group.com.goncalloramos.t3code.mobile`, and URL scheme
`t3code-goncalloramos`. Expo OTA updates are disabled. Use ad-hoc or private TestFlight distribution;
configure a dedicated `T3CODE_EAS_PROJECT_ID` only after creating a private goncalloramos EAS
project. Missing or invalid `T3CODE_APPLE_TEAM_ID` fails configuration before native build work.

The initial release guarantees foreground control and reconnect/outbox recovery. Background push,
remote Live Activities, Android distribution, public relay access, and App Store publication remain
deferred.
