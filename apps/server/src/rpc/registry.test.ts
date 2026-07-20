import { WsRpcGroup } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";

import { RPC_REQUIRED_SCOPE } from "../ws.ts";
import { ACCESS_RPC_METHODS } from "./access.ts";
import { FILESYSTEM_RPC_METHODS } from "./filesystem.ts";
import { GIT_RPC_METHODS } from "./git.ts";
import { ORCHESTRATION_RPC_METHODS } from "./orchestration.ts";
import { PREVIEW_RPC_METHODS } from "./preview.ts";
import { PROJECT_RPC_METHODS } from "./projects.ts";
import { PROVIDER_RPC_METHODS } from "./providers.ts";
import { RELAY_RPC_METHODS } from "./relay.ts";
import { SERVER_RPC_METHODS } from "./server.ts";
import { SETTINGS_RPC_METHODS } from "./settings.ts";
import { SOURCE_CONTROL_RPC_METHODS } from "./sourceControl.ts";
import { TERMINAL_RPC_METHODS } from "./terminal.ts";
import { VCS_STATUS_RPC_METHODS } from "./vcs.ts";

const DOMAIN_RPC_METHODS = [
  ...ORCHESTRATION_RPC_METHODS,
  ...PROVIDER_RPC_METHODS,
  ...SETTINGS_RPC_METHODS,
  ...SERVER_RPC_METHODS,
  ...RELAY_RPC_METHODS,
  ...SOURCE_CONTROL_RPC_METHODS,
  ...PROJECT_RPC_METHODS,
  ...FILESYSTEM_RPC_METHODS,
  ...VCS_STATUS_RPC_METHODS,
  ...GIT_RPC_METHODS,
  ...TERMINAL_RPC_METHODS,
  ...PREVIEW_RPC_METHODS,
  ...ACCESS_RPC_METHODS,
] as const;

describe("WebSocket RPC registry", () => {
  it("assigns every RPC method to exactly one domain handler registry", () => {
    const registeredMethods = Array.from(WsRpcGroup.requests.keys()).toSorted();
    const domainMethods = Array.from(DOMAIN_RPC_METHODS).toSorted();

    assert.deepStrictEqual(domainMethods, registeredMethods);
    assert.strictEqual(new Set(domainMethods).size, domainMethods.length);
  });

  it("declares one central authorization scope for every RPC method", () => {
    assert.deepStrictEqual(
      Array.from(RPC_REQUIRED_SCOPE.keys()).toSorted(),
      [...WsRpcGroup.requests.keys()].toSorted(),
    );
  });
});
