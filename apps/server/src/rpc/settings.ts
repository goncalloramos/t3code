import { WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type * as Keybindings from "../keybindings.ts";
import * as ServerSettings from "../serverSettings.ts";
import type { RpcHandlerObservers } from "./handlers.ts";

export const SETTINGS_RPC_METHODS = [
  WS_METHODS.serverUpsertKeybinding,
  WS_METHODS.serverRemoveKeybinding,
  WS_METHODS.serverGetSettings,
  WS_METHODS.serverUpdateSettings,
] as const;

export function makeSettingsRpcHandlers(
  services: {
    readonly keybindings: Pick<
      Keybindings.Keybindings["Service"],
      "upsertKeybindingRule" | "removeKeybindingRule"
    >;
    readonly serverSettings: Pick<
      ServerSettings.ServerSettingsService["Service"],
      "getSettings" | "updateSettings"
    >;
  },
  { observeEffect }: Pick<RpcHandlerObservers, "observeEffect">,
) {
  const traceAttributes = { "rpc.aggregate": "server" } as const;
  const { keybindings, serverSettings } = services;

  return {
    [WS_METHODS.serverUpsertKeybinding]: (
      rule: Parameters<typeof keybindings.upsertKeybindingRule>[0],
    ) =>
      observeEffect(
        WS_METHODS.serverUpsertKeybinding,
        Effect.gen(function* () {
          const keybindingsConfig = yield* keybindings.upsertKeybindingRule(rule);
          return { keybindings: keybindingsConfig, issues: [] };
        }),
        traceAttributes,
      ),
    [WS_METHODS.serverRemoveKeybinding]: (
      rule: Parameters<typeof keybindings.removeKeybindingRule>[0],
    ) =>
      observeEffect(
        WS_METHODS.serverRemoveKeybinding,
        Effect.gen(function* () {
          const keybindingsConfig = yield* keybindings.removeKeybindingRule(rule);
          return { keybindings: keybindingsConfig, issues: [] };
        }),
        traceAttributes,
      ),
    [WS_METHODS.serverGetSettings]: (_input: {}) =>
      observeEffect(
        WS_METHODS.serverGetSettings,
        serverSettings.getSettings.pipe(Effect.map(ServerSettings.redactServerSettingsForClient)),
        traceAttributes,
      ),
    [WS_METHODS.serverUpdateSettings]: (input: {
      readonly patch: Parameters<typeof serverSettings.updateSettings>[0];
    }) =>
      observeEffect(
        WS_METHODS.serverUpdateSettings,
        serverSettings
          .updateSettings(input.patch)
          .pipe(Effect.map(ServerSettings.redactServerSettingsForClient)),
        traceAttributes,
      ),
  };
}
