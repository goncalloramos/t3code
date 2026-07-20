import { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";

import type { ConnectionCatalogEntry } from "../connection/catalog.ts";
import {
  AVAILABLE_CONNECTION_STATE,
  ConnectionBlockedError,
  ConnectionTransientError,
  PrimaryConnectionTarget,
  type SupervisorConnectionState,
} from "../connection/model.ts";
import type { EnvironmentShellState } from "../state/shell.ts";
import { adaptWorkspaceEnvironment, adaptWorkspaceEnvironments } from "./adapters.ts";
import { makeWorkspaceEnvironmentFixture } from "./fixtures.ts";

const environmentId = EnvironmentId.make("local");
const entry: ConnectionCatalogEntry = {
  target: new PrimaryConnectionTarget({
    environmentId,
    label: "Local",
    httpBaseUrl: "http://localhost:3000",
    wsBaseUrl: "ws://localhost:3000",
  }),
  profile: Option.none(),
};
const snapshot = makeWorkspaceEnvironmentFixture({ environmentId }).snapshot!;

function shell(input: Partial<EnvironmentShellState> = {}): EnvironmentShellState {
  return {
    snapshot: Option.some(snapshot),
    status: "live",
    error: Option.none(),
    ...input,
  };
}

function connection(input: Partial<SupervisorConnectionState> = {}): SupervisorConnectionState {
  return { ...AVAILABLE_CONNECTION_STATE, desired: true, ...input };
}

describe("workspace snapshot adapters", () => {
  it("projects a live environment without copying its shell snapshot", () => {
    const result = adaptWorkspaceEnvironment({
      entry,
      connection: connection({ phase: "connected" }),
      shell: shell(),
    });

    expect(result.snapshot).toBe(snapshot);
    expect(result.connection).toEqual({
      environmentId: "local",
      label: "Local",
      phase: "live",
      hasSnapshot: true,
      error: null,
      snapshotUpdatedAt: snapshot.updatedAt,
      retryAt: null,
    });
  });

  it.each([
    {
      name: "reconnecting",
      state: connection({
        phase: "backoff",
        attempt: 2,
        retryAt: 42,
        lastFailure: new ConnectionTransientError({
          reason: "transport",
          detail: "Socket closed",
        }),
      }),
      expectedPhase: "reconnecting",
      expectedError: "Socket closed",
    },
    {
      name: "offline",
      state: connection({ phase: "offline", network: "offline" }),
      expectedPhase: "offline",
      expectedError: null,
    },
    {
      name: "authentication failure",
      state: connection({
        phase: "blocked",
        lastFailure: new ConnectionBlockedError({
          reason: "authentication",
          detail: "Sign in again",
        }),
      }),
      expectedPhase: "authentication-error",
      expectedError: "Sign in again",
    },
    {
      name: "unsupported environment",
      state: connection({
        phase: "blocked",
        lastFailure: new ConnectionBlockedError({
          reason: "unsupported",
          detail: "Upgrade required",
        }),
      }),
      expectedPhase: "unavailable",
      expectedError: "Upgrade required",
    },
  ])("retains the cached snapshot while $name", ({ state, expectedPhase, expectedError }) => {
    const result = adaptWorkspaceEnvironment({ entry, connection: state, shell: shell() });

    expect(result.snapshot).toBe(snapshot);
    expect(result.connection.phase).toBe(expectedPhase);
    expect(result.connection.error).toBe(expectedError);
    expect(result.connection.hasSnapshot).toBe(true);
  });

  it("marks connected cached data stale and exposes shell synchronization failures", () => {
    const result = adaptWorkspaceEnvironment({
      entry,
      connection: connection({ phase: "connected" }),
      shell: shell({ status: "cached", error: Option.some("Could not synchronize") }),
    });

    expect(result.connection.phase).toBe("stale");
    expect(result.connection.error).toBe("Could not synchronize");
    expect(result.snapshot).toBe(snapshot);
  });

  it("projects catalog order through supplied live state readers", () => {
    const remoteId = EnvironmentId.make("remote");
    const remoteEntry: ConnectionCatalogEntry = {
      ...entry,
      target: new PrimaryConnectionTarget({
        environmentId: remoteId,
        label: "Remote",
        httpBaseUrl: "http://remote:3000",
        wsBaseUrl: "ws://remote:3000",
      }),
    };
    const states = new Map([
      [environmentId, connection({ phase: "connected" })],
      [remoteId, connection({ phase: "connecting", attempt: 1 })],
    ]);

    const result = adaptWorkspaceEnvironments({
      entries: new Map([
        [environmentId, entry],
        [remoteId, remoteEntry],
      ]),
      connectionFor: (id) => states.get(id)!,
      shellFor: (id) => (id === environmentId ? shell() : shell({ snapshot: Option.none() })),
    });

    expect(result.map(({ connection: item }) => [item.environmentId, item.phase])).toEqual([
      ["local", "live"],
      ["remote", "connecting"],
    ]);
  });
});
