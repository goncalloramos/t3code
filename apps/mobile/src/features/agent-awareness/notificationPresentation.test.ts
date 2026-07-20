import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const setNotificationHandler = vi.hoisted(() => vi.fn());

vi.mock("expo-notifications", () => ({ setNotificationHandler }));

import { installAgentNotificationPresentation } from "./notificationPresentation";

describe("installAgentNotificationPresentation", () => {
  beforeEach(() => {
    setNotificationHandler.mockReset();
  });

  it("shows foreground agent notifications in the banner and list with sound", async () => {
    installAgentNotificationPresentation();

    const handler = setNotificationHandler.mock.calls[0]?.[0];
    await expect(handler.handleNotification()).resolves.toEqual({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    });
  });
});
