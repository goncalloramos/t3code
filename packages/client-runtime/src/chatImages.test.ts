import { describe, expect, it } from "vite-plus/test";

import {
  extractDirectWorkLogImages,
  extractWorkLogImages,
  resolveDirectChatImageUrl,
} from "./chatImages.js";

describe("chatImages", () => {
  it("prefers embedded generated image data over a machine-local saved path", () => {
    const payload = {
      type: "imageGeneration",
      savedPath: "/Users/alice/.codex/generated_images/thread/image.png",
      result: "aW1hZ2U=",
    };

    expect(extractWorkLogImages(payload)).toEqual([
      { source: "data:image/png;base64,aW1hZ2U=", alt: "Tool image" },
    ]);
    expect(extractDirectWorkLogImages(payload)).toEqual([
      { source: "data:image/png;base64,aW1hZ2U=", alt: "Tool image" },
    ]);
  });

  it("keeps path-only images out of remote-client image sources", () => {
    expect(
      extractDirectWorkLogImages({ type: "imageView", path: "/Users/alice/private.png" }),
    ).toEqual([]);
  });

  it("rejects unsafe inline image types", () => {
    expect(resolveDirectChatImageUrl("data:image/svg+xml,<svg onload=alert(1) />")).toBeNull();
  });
});
