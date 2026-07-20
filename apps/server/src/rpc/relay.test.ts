import { assert, describe, it } from "@effect/vitest";
import {
  RelayClientInstallFailedError,
  type RelayClientInstallProgressEvent,
  WS_METHODS,
} from "@t3tools/contracts";
import { RelayClientInstallError, type RelayClientShape } from "@t3tools/shared/relayClient";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import type { RpcHandlerObservers } from "./handlers.ts";
import { makeRelayRpcHandlers, RELAY_RPC_METHODS } from "./relay.ts";

const status = {
  status: "available",
  executablePath: "/bin/cloudflared",
  source: "managed",
  version: "2026.5.2",
} as const;

const observeEffect: RpcHandlerObservers["observeEffect"] = (_method, effect) => effect;
const observeStream: RpcHandlerObservers["observeStream"] = (_method, stream) => stream;

function makeRelayClient(
  installWithProgress: RelayClientShape["installWithProgress"] = () => Effect.succeed(status),
): RelayClientShape {
  return {
    resolve: Effect.succeed(status),
    install: Effect.succeed(status),
    installWithProgress,
  };
}

describe("relay RPC handlers", () => {
  it("registers the existing relay methods without omissions", () => {
    const handlers = makeRelayRpcHandlers(makeRelayClient(), { observeEffect, observeStream });

    assert.deepStrictEqual(Object.keys(handlers), [...RELAY_RPC_METHODS]);
  });

  it.effect("streams installer progress before the completion status", () =>
    Effect.gen(function* () {
      const progress = {
        type: "progress",
        stage: "downloading",
      } as const satisfies RelayClientInstallProgressEvent;
      const handlers = makeRelayRpcHandlers(
        makeRelayClient((report) => report(progress).pipe(Effect.as(status))),
        { observeEffect, observeStream },
      );

      const events = yield* handlers[WS_METHODS.cloudInstallRelayClient]({}).pipe(
        Stream.runCollect,
      );

      assert.deepStrictEqual(Array.from(events), [progress, { type: "complete", status }]);
    }),
  );

  it.effect("maps internal installation failures to the RPC contract error", () =>
    Effect.gen(function* () {
      const handlers = makeRelayRpcHandlers(
        makeRelayClient(() =>
          Effect.fail(
            new RelayClientInstallError({
              reason: "download_failed",
              message: "download unavailable",
            }),
          ),
        ),
        { observeEffect, observeStream },
      );

      const error = yield* handlers[WS_METHODS.cloudInstallRelayClient]({}).pipe(
        Stream.runCollect,
        Effect.flip,
      );

      assert.instanceOf(error, RelayClientInstallFailedError);
      assert.strictEqual(error.reason, "download_failed");
      assert.strictEqual(error.message, "download unavailable");
    }),
  );
});
