import {
  DesktopApnsConfigurationStatusSchema,
  DesktopApnsCredentialImportInputSchema,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopBackendPool from "../../backend/DesktopBackendPool.ts";
import * as DesktopApnsCredentialsStore from "../../settings/DesktopApnsCredentialsStore.ts";
import * as IpcChannels from "../channels.ts";
import { makeIpcMethod } from "../DesktopIpc.ts";

const restartPrimary = Effect.fn("desktop.ipc.apns.restartPrimary")(function* () {
  const pool = yield* DesktopBackendPool.DesktopBackendPool;
  const primary = yield* pool.primary;
  yield* primary.stop();
  yield* primary.start;
  return true;
});

export const getApnsConfigurationStatus = makeIpcMethod({
  channel: IpcChannels.GET_APNS_CONFIGURATION_STATUS_CHANNEL,
  payload: Schema.Void,
  result: DesktopApnsConfigurationStatusSchema,
  handler: Effect.fn("desktop.ipc.apns.status")(function* () {
    const store = yield* DesktopApnsCredentialsStore.DesktopApnsCredentialsStore;
    return yield* store.status;
  }),
});

export const importApnsCredentials = makeIpcMethod({
  channel: IpcChannels.IMPORT_APNS_CREDENTIALS_CHANNEL,
  payload: DesktopApnsCredentialImportInputSchema,
  result: DesktopApnsConfigurationStatusSchema,
  handler: Effect.fn("desktop.ipc.apns.import")(function* (input) {
    const store = yield* DesktopApnsCredentialsStore.DesktopApnsCredentialsStore;
    const result = yield* store.importCredentials(input);
    if (result.imported) yield* restartPrimary();
    return result.status;
  }),
});

export const removeApnsCredentials = makeIpcMethod({
  channel: IpcChannels.REMOVE_APNS_CREDENTIALS_CHANNEL,
  payload: Schema.Void,
  result: DesktopApnsConfigurationStatusSchema,
  handler: Effect.fn("desktop.ipc.apns.remove")(function* () {
    const store = yield* DesktopApnsCredentialsStore.DesktopApnsCredentialsStore;
    const result = yield* store.remove;
    if (result.removed) yield* restartPrimary();
    return result.status;
  }),
});

export const restartPrimaryBackendForApns = makeIpcMethod({
  channel: IpcChannels.RESTART_PRIMARY_BACKEND_FOR_APNS_CHANNEL,
  payload: Schema.Void,
  result: Schema.Boolean,
  handler: restartPrimary,
});
