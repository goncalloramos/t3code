import * as Notifications from "expo-notifications";

/**
 * Expo suppresses notifications received while the app is in the foreground
 * unless an application handler chooses a presentation behavior. Agent-status
 * pushes should remain visible in that state, just as they are in the
 * background, so a user can move around the app without silently missing a
 * completion or input request.
 */
export function installAgentNotificationPresentation(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}
