import { type DiscoveredLocalServerList, WS_METHODS } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import type * as PreviewAutomationBroker from "../mcp/PreviewAutomationBroker.ts";
import type * as PreviewManager from "../preview/Manager.ts";
import type * as PortScanner from "../preview/PortScanner.ts";
import type { RpcHandlerObservers } from "./handlers.ts";

export const PREVIEW_RPC_METHODS = [
  WS_METHODS.previewOpen,
  WS_METHODS.previewNavigate,
  WS_METHODS.previewResize,
  WS_METHODS.previewRefresh,
  WS_METHODS.previewClose,
  WS_METHODS.previewList,
  WS_METHODS.previewReportStatus,
  WS_METHODS.previewAutomationConnect,
  WS_METHODS.previewAutomationRespond,
  WS_METHODS.previewAutomationFocusHost,
  WS_METHODS.subscribePreviewEvents,
  WS_METHODS.subscribeDiscoveredLocalServers,
] as const;

export function makePreviewRpcHandlers(
  services: {
    readonly previewManager: PreviewManager.PreviewManager["Service"];
    readonly previewAutomationBroker: PreviewAutomationBroker.PreviewAutomationBroker["Service"];
    readonly portDiscovery: PortScanner.PortDiscovery["Service"];
  },
  { observeEffect, observeStream, observeStreamEffect }: RpcHandlerObservers,
) {
  const previewTrace = { "rpc.aggregate": "preview" } as const;
  const automationTrace = { "rpc.aggregate": "preview-automation" } as const;
  const { portDiscovery, previewAutomationBroker, previewManager } = services;

  return {
    [WS_METHODS.previewOpen]: (input: Parameters<typeof previewManager.open>[0]) =>
      observeEffect(WS_METHODS.previewOpen, previewManager.open(input), previewTrace),
    [WS_METHODS.previewNavigate]: (input: Parameters<typeof previewManager.navigate>[0]) =>
      observeEffect(WS_METHODS.previewNavigate, previewManager.navigate(input), previewTrace),
    [WS_METHODS.previewResize]: (input: Parameters<typeof previewManager.resize>[0]) =>
      observeEffect(WS_METHODS.previewResize, previewManager.resize(input), previewTrace),
    [WS_METHODS.previewRefresh]: (input: Parameters<typeof previewManager.refresh>[0]) =>
      observeEffect(WS_METHODS.previewRefresh, previewManager.refresh(input), previewTrace),
    [WS_METHODS.previewClose]: (input: Parameters<typeof previewManager.close>[0]) =>
      observeEffect(WS_METHODS.previewClose, previewManager.close(input), previewTrace),
    [WS_METHODS.previewList]: (input: Parameters<typeof previewManager.list>[0]) =>
      observeEffect(WS_METHODS.previewList, previewManager.list(input), previewTrace),
    [WS_METHODS.previewReportStatus]: (input: Parameters<typeof previewManager.reportStatus>[0]) =>
      observeEffect(
        WS_METHODS.previewReportStatus,
        previewManager.reportStatus(input),
        previewTrace,
      ),
    [WS_METHODS.previewAutomationConnect]: (
      input: Parameters<typeof previewAutomationBroker.connect>[0],
    ) =>
      observeStreamEffect(
        WS_METHODS.previewAutomationConnect,
        previewAutomationBroker.connect(input),
        automationTrace,
      ),
    [WS_METHODS.previewAutomationRespond]: (
      input: Parameters<typeof previewAutomationBroker.respond>[0],
    ) =>
      observeEffect(
        WS_METHODS.previewAutomationRespond,
        previewAutomationBroker.respond(input),
        automationTrace,
      ),
    [WS_METHODS.previewAutomationFocusHost]: (
      input: Parameters<typeof previewAutomationBroker.focusHost>[0],
    ) =>
      observeEffect(
        WS_METHODS.previewAutomationFocusHost,
        previewAutomationBroker.focusHost(input),
        automationTrace,
      ),
    [WS_METHODS.subscribePreviewEvents]: (_input: {}) =>
      observeStream(WS_METHODS.subscribePreviewEvents, previewManager.events, previewTrace),
    [WS_METHODS.subscribeDiscoveredLocalServers]: (_input: {}) =>
      observeStream(
        WS_METHODS.subscribeDiscoveredLocalServers,
        Stream.callback<DiscoveredLocalServerList>((queue) =>
          Effect.gen(function* () {
            yield* portDiscovery.retain;
            const initial = yield* portDiscovery.scan();
            const initialScannedAt = DateTime.formatIso(yield* DateTime.now);
            yield* Queue.offer(queue, {
              servers: initial,
              scannedAt: initialScannedAt,
            });
            yield* portDiscovery.subscribe((servers) =>
              Effect.gen(function* () {
                const scannedAt = DateTime.formatIso(yield* DateTime.now);
                yield* Queue.offer(queue, { servers, scannedAt });
              }),
            );
          }),
        ),
        previewTrace,
      ),
  };
}
