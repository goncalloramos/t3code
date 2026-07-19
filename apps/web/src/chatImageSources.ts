import type { ScopedThreadRef } from "@t3tools/contracts";

import { resolveMarkdownFileLinkMeta } from "./markdown-links";

const DIRECT_IMAGE_URL_PATTERN = /^(?:https?:|blob:)/i;
const SAFE_DATA_IMAGE_URL_PATTERN =
  /^data:image\/(?:avif|gif|jpe?g|png|webp);base64,[a-z0-9+/=\s]+$/i;

export interface WorkLogImage {
  readonly source: string;
  readonly alt: string;
}

export type ResolvedChatImageSource =
  | { readonly kind: "direct"; readonly url: string }
  | {
      readonly kind: "workspace-file";
      readonly path: string;
      readonly threadRef: ScopedThreadRef;
    };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isSafeDirectImageUrl(value: string): boolean {
  return DIRECT_IMAGE_URL_PATTERN.test(value) || SAFE_DATA_IMAGE_URL_PATTERN.test(value);
}

function imageSourceFromRecord(record: Record<string, unknown>): string | null {
  const type = asNonEmptyString(record.type);
  if (type === "inputImage") {
    return asNonEmptyString(record.imageUrl);
  }
  if (type === "input_image") {
    return asNonEmptyString(record.image_url);
  }
  if (type === "imageView") {
    return asNonEmptyString(record.path);
  }
  if (type === "imageGeneration") {
    const savedPath = asNonEmptyString(record.savedPath);
    if (savedPath) return savedPath;
    const result = asNonEmptyString(record.result);
    if (!result) return null;
    if (isSafeDirectImageUrl(result)) return result;
    if (/^[a-z0-9+/=\s]+$/i.test(result)) {
      return `data:image/png;base64,${result}`;
    }
  }
  return null;
}

/** Extract displayable image content from canonical tool lifecycle payload data. */
export function extractWorkLogImages(
  value: unknown,
  alt = "Tool image",
): ReadonlyArray<WorkLogImage> {
  const images: WorkLogImage[] = [];
  const seen = new Set<string>();
  let visitedNodes = 0;

  const visit = (candidate: unknown, depth: number) => {
    visitedNodes += 1;
    if (depth > 7 || images.length >= 8 || visitedNodes > 512) return;
    if (Array.isArray(candidate)) {
      for (const entry of candidate) {
        visit(entry, depth + 1);
        if (images.length >= 8) return;
      }
      return;
    }

    const record = asRecord(candidate);
    if (!record) return;

    const source = imageSourceFromRecord(record);
    if (source && !seen.has(source)) {
      seen.add(source);
      images.push({ source, alt });
    }

    for (const nested of Object.values(record)) {
      if (typeof nested === "object" && nested !== null) {
        visit(nested, depth + 1);
      }
    }
  };

  visit(value, 0);
  return images;
}

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
  return SAFE_DATA_IMAGE_URL_PATTERN.test(value.trim());
}
