import { assert, describe, it } from "@effect/vitest";
import { ProviderInstanceId, WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import type { RpcHandlerObservers } from "./handlers.ts";
import {
  makeProviderRpcHandlers,
  makeProviderStatusUpdates,
  PROVIDER_RPC_METHODS,
} from "./providers.ts";

const observeEffect: RpcHandlerObservers["observeEffect"] = (_method, effect) => effect;

describe("provider RPC handlers", () => {
  it("registers the existing provider method identifiers without additions or omissions", () => {
    const handlers = makeProviderRpcHandlers(
      {
        providerRegistry: {
          refresh: () => Effect.succeed([]),
          refreshInstance: () => Effect.succeed([]),
        },
        providerMaintenanceRunner: {
          updateProvider: () => Effect.succeed({ providers: [] }),
        },
      },
      { observeEffect },
    );

    assert.deepStrictEqual(Object.keys(handlers), [...PROVIDER_RPC_METHODS]);
  });

  it.effect("targets instance refreshes and preserves untargeted refresh compatibility", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<ReadonlyArray<string>>([]);
      const handlers = makeProviderRpcHandlers(
        {
          providerRegistry: {
            refresh: () => Ref.update(calls, (current) => [...current, "all"]).pipe(Effect.as([])),
            refreshInstance: (instanceId) =>
              Ref.update(calls, (current) => [...current, instanceId]).pipe(Effect.as([])),
          },
          providerMaintenanceRunner: {
            updateProvider: () => Effect.succeed({ providers: [] }),
          },
        },
        { observeEffect },
      );
      const instanceId = ProviderInstanceId.make("codex-work");

      yield* handlers[WS_METHODS.serverRefreshProviders]({});
      yield* handlers[WS_METHODS.serverRefreshProviders]({ instanceId });

      assert.deepStrictEqual(yield* Ref.get(calls), ["all", instanceId]);
    }),
  );

  it.effect("projects provider snapshots into debounced server-config events", () =>
    Effect.gen(function* () {
      const events = yield* makeProviderStatusUpdates({
        streamChanges: Stream.fromIterable([[], []]),
      }).pipe(Stream.runCollect);

      assert.deepStrictEqual(Array.from(events), [
        { version: 1, type: "providerStatuses", payload: { providers: [] } },
      ]);
    }),
  );
});
