import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { powerSaveBlocker } from "electron";

import * as DesktopEnvironment from "./DesktopEnvironment.ts";

export class DesktopHostAwakeError extends Schema.TaggedErrorClass<DesktopHostAwakeError>()(
  "DesktopHostAwakeError",
  { operation: Schema.Literals(["start", "stop"]), cause: Schema.Defect() },
) {}

interface AwakeResources {
  readonly blockerId: number;
  readonly caffeinate: Option.Option<ChildProcessSpawner.ChildProcessHandle>;
}

export class DesktopHostAwake extends Context.Service<
  DesktopHostAwake,
  {
    readonly active: Effect.Effect<boolean>;
    readonly setEnabled: (enabled: boolean) => Effect.Effect<void, DesktopHostAwakeError>;
  }
>()("@t3tools/desktop/app/DesktopHostAwake") {}

export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const scope = yield* Scope.Scope;
  const resourcesRef = yield* Ref.make<Option.Option<AwakeResources>>(Option.none());

  const stop = Effect.fn("desktop.hostAwake.stop")(
    function* () {
      const resources = yield* Ref.getAndSet(resourcesRef, Option.none());
      if (Option.isNone(resources)) return;
      powerSaveBlocker.stop(resources.value.blockerId);
      if (Option.isSome(resources.value.caffeinate)) {
        yield* resources.value.caffeinate.value
          .kill({ killSignal: "SIGTERM", forceKillAfter: 2_000 })
          .pipe(Effect.ignore);
      }
    },
    Effect.mapError((cause) => new DesktopHostAwakeError({ operation: "stop", cause })),
  );

  const start = Effect.fn("desktop.hostAwake.start")(
    function* () {
      if (Option.isSome(yield* Ref.get(resourcesRef))) return;
      const blockerId = powerSaveBlocker.start("prevent-app-suspension");
      const caffeinate =
        environment.platform === "darwin"
          ? Option.some(
              yield* spawner
                .spawn(ChildProcess.make("/usr/bin/caffeinate", ["-i", "-w", String(process.pid)]))
                .pipe(Effect.provideService(Scope.Scope, scope)),
            )
          : Option.none<ChildProcessSpawner.ChildProcessHandle>();
      yield* Ref.set(resourcesRef, Option.some({ blockerId, caffeinate }));
    },
    Effect.mapError((cause) => new DesktopHostAwakeError({ operation: "start", cause })),
  );

  yield* Effect.addFinalizer(() => stop().pipe(Effect.ignore));

  return DesktopHostAwake.of({
    active: Ref.get(resourcesRef).pipe(Effect.map(Option.isSome)),
    setEnabled: (enabled) => (enabled ? start() : stop()),
  });
});

export const layer = Layer.effect(DesktopHostAwake, make);
