import {
  DesktopRemoteModePreferencesSchema,
  DesktopRemoteModeStateSchema,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopLifecycle from "../../app/DesktopLifecycle.ts";
import * as DesktopRemoteAccess from "../../app/DesktopRemoteAccess.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export const getRemoteModeState = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.GET_REMOTE_MODE_STATE_CHANNEL,
  payload: Schema.Void,
  result: DesktopRemoteModeStateSchema,
  handler: Effect.fn("desktop.ipc.remoteAccess.getState")(function* () {
    const remoteAccess = yield* DesktopRemoteAccess.DesktopRemoteAccess;
    return yield* remoteAccess.getState;
  }),
});

export const setRemoteModePreferences = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SET_REMOTE_MODE_PREFERENCES_CHANNEL,
  payload: DesktopRemoteModePreferencesSchema,
  result: DesktopRemoteModeStateSchema,
  handler: Effect.fn("desktop.ipc.remoteAccess.setPreferences")(function* (preferences) {
    const remoteAccess = yield* DesktopRemoteAccess.DesktopRemoteAccess;
    const lifecycle = yield* DesktopLifecycle.DesktopLifecycle;
    const change = yield* remoteAccess.setPreferences(preferences);
    if (change.requiresRelaunch) {
      yield* lifecycle.relaunch(
        preferences.enabled ? "remote-mode-enabled" : "remote-mode-disabled",
      );
    }
    return change.state;
  }),
});

export const retryRemoteMode = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.RETRY_REMOTE_MODE_CHANNEL,
  payload: Schema.Void,
  result: DesktopRemoteModeStateSchema,
  handler: Effect.fn("desktop.ipc.remoteAccess.retry")(function* () {
    const remoteAccess = yield* DesktopRemoteAccess.DesktopRemoteAccess;
    return yield* remoteAccess.reconcile;
  }),
});
