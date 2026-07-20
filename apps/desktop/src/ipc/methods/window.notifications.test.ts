import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { describe, expect, vi } from "vite-plus/test";

const electron = vi.hoisted(() => {
  type Listener = () => void;

  class Notification {
    static readonly instances: Notification[] = [];
    static isSupported = vi.fn(() => true);

    readonly close = vi.fn(() => this.emit("close"));
    readonly show = vi.fn();
    readonly options: { readonly title: string; readonly body: string };
    private readonly listeners = new Map<string, Listener[]>();

    constructor(options: { readonly title: string; readonly body: string }) {
      this.options = options;
      Notification.instances.push(this);
    }

    on(event: string, listener: Listener): this {
      const listeners = this.listeners.get(event) ?? [];
      listeners.push(listener);
      this.listeners.set(event, listeners);
      return this;
    }

    emit(event: string): void {
      for (const listener of this.listeners.get(event) ?? []) listener();
    }
  }

  return {
    Notification,
    getAllWindows: vi.fn(),
    focusApp: vi.fn(),
  };
});

vi.mock("electron", () => ({
  Notification: electron.Notification,
  BrowserWindow: { getAllWindows: electron.getAllWindows },
  app: { focus: electron.focusApp },
  shell: { openExternal: vi.fn(), openPath: vi.fn() },
}));

import { AGENT_NOTIFICATION_CLICK_CHANNEL } from "../channels.ts";
import { showAgentNotification } from "./window.ts";

function makeWindow(input: { focused?: boolean; minimized?: boolean; visible?: boolean } = {}) {
  return {
    isDestroyed: vi.fn(() => false),
    isFocused: vi.fn(() => input.focused ?? false),
    isMinimized: vi.fn(() => input.minimized ?? false),
    isVisible: vi.fn(() => input.visible ?? true),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    webContents: { send: vi.fn() },
  };
}

const notification = {
  kind: "completion",
  environmentId: "environment-1",
  threadId: "thread-1",
  title: "Agent finished",
  body: "Review the result",
} as const;

describe("showAgentNotification", () => {
  it.effect("suppresses the native alert while the Electron window is focused", () =>
    Effect.gen(function* () {
      electron.getAllWindows.mockReturnValue([makeWindow({ focused: true })]);

      expect(yield* showAgentNotification.handler(notification)).toBe(false);
      expect(electron.Notification.instances).toHaveLength(0);
    }),
  );

  it.effect("replaces the previous alert for the same environment and thread", () =>
    Effect.gen(function* () {
      electron.getAllWindows.mockReturnValue([makeWindow()]);

      yield* showAgentNotification.handler(notification);
      const first = electron.Notification.instances.at(-1)!;
      yield* showAgentNotification.handler({ ...notification, title: "Agent needs input" });

      expect(first.close).toHaveBeenCalledOnce();
      expect(electron.Notification.instances.at(-1)?.options.title).toBe("Agent needs input");
    }),
  );

  it.effect("restores and focuses the target thread when the alert is clicked", () =>
    Effect.gen(function* () {
      const window = makeWindow({ minimized: true, visible: false });
      electron.getAllWindows.mockReturnValue([window]);
      yield* showAgentNotification.handler(notification);

      electron.Notification.instances.at(-1)!.emit("click");

      expect(window.restore).toHaveBeenCalledOnce();
      expect(window.show).toHaveBeenCalledOnce();
      expect(electron.focusApp).toHaveBeenCalledWith({ steal: true });
      expect(window.focus).toHaveBeenCalledOnce();
      expect(window.webContents.send).toHaveBeenCalledWith(AGENT_NOTIFICATION_CLICK_CHANNEL, {
        environmentId: "environment-1",
        threadId: "thread-1",
      });
    }),
  );
});
