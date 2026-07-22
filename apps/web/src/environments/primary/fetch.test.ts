import { afterEach, describe, expect, it, vi } from "@effect/vitest";

import { __resetDesktopPrimaryAuthForTests } from "./desktopAuth";
import { fetchPrimaryEnvironment } from "./fetch";

describe("fetchPrimaryEnvironment", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    __resetDesktopPrimaryAuthForTests();
  });

  it("authenticates desktop requests with the scoped bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", {
      desktopBridge: {
        getLocalEnvironmentBearerToken: vi.fn().mockResolvedValue("desktop-token"),
      },
    });

    await fetchPrimaryEnvironment("/api/agent-notifications/status");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer desktop-token");
    expect(init.credentials).toBe("omit");
  });

  it("uses same-origin cookies outside the desktop renderer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", {});

    await fetchPrimaryEnvironment("/api/agent-notifications/status");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).has("Authorization")).toBe(false);
    expect(init.credentials).toBe("include");
  });
});
