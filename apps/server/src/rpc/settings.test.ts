import { assert, describe, it } from "@effect/vitest";
import { DEFAULT_SERVER_SETTINGS, WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { RpcHandlerObservers } from "./handlers.ts";
import { makeSettingsRpcHandlers, SETTINGS_RPC_METHODS } from "./settings.ts";

const observeEffect: RpcHandlerObservers["observeEffect"] = (_method, effect) => effect;

function makeServices() {
  return {
    keybindings: {
      upsertKeybindingRule: () => Effect.succeed([]),
      removeKeybindingRule: () => Effect.succeed([]),
    },
    serverSettings: {
      getSettings: Effect.succeed(DEFAULT_SERVER_SETTINGS),
      updateSettings: () => Effect.succeed(DEFAULT_SERVER_SETTINGS),
    },
  } satisfies Parameters<typeof makeSettingsRpcHandlers>[0];
}

describe("settings RPC handlers", () => {
  it("registers the existing settings method identifiers without additions or omissions", () => {
    const handlers = makeSettingsRpcHandlers(makeServices(), { observeEffect });

    assert.deepStrictEqual(Object.keys(handlers), [...SETTINGS_RPC_METHODS]);
  });

  it.effect("preserves keybinding response compatibility fields", () =>
    Effect.gen(function* () {
      const handlers = makeSettingsRpcHandlers(makeServices(), { observeEffect });
      const result = yield* handlers[WS_METHODS.serverUpsertKeybinding]({
        key: "meta+k",
        command: "commandPalette.toggle",
      });

      assert.deepStrictEqual(result, { keybindings: [], issues: [] });
    }),
  );
});
