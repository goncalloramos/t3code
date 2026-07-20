import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  extractWorkLogImages,
  isSafeChatDataImageUrl,
  isSafeDirectImageUrl,
  type WorkLogImage,
} from "@t3tools/client-runtime/chat-images";

import { resolveMarkdownFileLinkMeta } from "./markdown-links";

export { extractWorkLogImages, type WorkLogImage };

export type ResolvedChatImageSource =
  | { readonly kind: "direct"; readonly url: string }
  | {
      readonly kind: "workspace-file";
      readonly path: string;
      readonly threadRef: ScopedThreadRef;
    };

export function resolveChatImageSource(input: {
  readonly source: string;
  readonly cwd: string | undefined;
  readonly threadRef: ScopedThreadRef | undefined;
}): ResolvedChatImageSource | null {
  const source = input.source.trim();
  if (isSafeDirectImageUrl(source)) {
    return { kind: "direct", url: source };
  }

  const file = resolveMarkdownFileLinkMeta(source, input.cwd);
  if (!file || !input.threadRef) return null;
  return {
    kind: "workspace-file",
    path: file.filePath,
    threadRef: input.threadRef,
  };
}

export function isSafeMarkdownDataImageUrl(value: string): boolean {
  return isSafeChatDataImageUrl(value);
}
