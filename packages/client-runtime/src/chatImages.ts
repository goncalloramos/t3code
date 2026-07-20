const DIRECT_IMAGE_URL_PATTERN = /^(?:https?:|blob:)/i;
const SAFE_DATA_IMAGE_URL_PATTERN =
  /^data:image\/(?:avif|gif|jpe?g|png|webp);base64,[a-z0-9+/=\s]+$/i;

export interface WorkLogImage {
  readonly source: string;
  readonly alt: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isSafeDirectImageUrl(value: string): boolean {
  return DIRECT_IMAGE_URL_PATTERN.test(value) || SAFE_DATA_IMAGE_URL_PATTERN.test(value);
}

export function resolveDirectChatImageUrl(value: string): string | null {
  const source = value.trim();
  return isSafeDirectImageUrl(source) ? source : null;
}

function imageGenerationSource(record: Record<string, unknown>): string | null {
  const result = asNonEmptyString(record.result);
  if (result) {
    if (isSafeDirectImageUrl(result)) return result;
    if (/^[a-z0-9+/=\s]+$/i.test(result)) {
      return `data:image/png;base64,${result}`;
    }
  }
  return asNonEmptyString(record.savedPath);
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
    return imageGenerationSource(record);
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

export function extractDirectWorkLogImages(
  value: unknown,
  alt = "Tool image",
): ReadonlyArray<WorkLogImage> {
  return extractWorkLogImages(value, alt).flatMap((image) => {
    const source = resolveDirectChatImageUrl(image.source);
    return source ? [{ ...image, source }] : [];
  });
}

export function isSafeChatDataImageUrl(value: string): boolean {
  return SAFE_DATA_IMAGE_URL_PATTERN.test(value.trim());
}
