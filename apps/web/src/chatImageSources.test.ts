import { ThreadId, EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { extractWorkLogImages, resolveChatImageSource } from "./chatImageSources";

describe("chatImageSources", () => {
  it("extracts dynamic tool images, image-view paths, and generated image paths", () => {
    expect(
      extractWorkLogImages(
        {
          item: {
            type: "dynamicToolCall",
            contentItems: [
              { type: "inputText", text: "preview" },
              { type: "inputImage", imageUrl: "data:image/png;base64,aW1hZ2U=" },
            ],
          },
          extra: { type: "imageView", path: "/repo/assets/icon.png" },
          generated: { type: "imageGeneration", savedPath: "/repo/generated/hero.png" },
        },
        "Preview image",
      ),
    ).toEqual([
      { source: "data:image/png;base64,aW1hZ2U=", alt: "Preview image" },
      { source: "/repo/assets/icon.png", alt: "Preview image" },
      { source: "/repo/generated/hero.png", alt: "Preview image" },
    ]);
  });

  it("prefers embedded generated image data over a Mac-only saved path", () => {
    expect(
      extractWorkLogImages({
        type: "imageGeneration",
        savedPath: "/Users/alice/.codex/generated_images/thread/image.png",
        result: "aW1hZ2U=",
      }),
    ).toEqual([{ source: "data:image/png;base64,aW1hZ2U=", alt: "Tool image" }]);
  });

  it("resolves workspace image paths through the scoped thread", () => {
    const threadRef = {
      environmentId: EnvironmentId.make("local"),
      threadId: ThreadId.make("thread-1"),
    };
    expect(
      resolveChatImageSource({
        source: "assets/icon.png",
        cwd: "/repo",
        threadRef,
      }),
    ).toEqual({ kind: "workspace-file", path: "/repo/assets/icon.png", threadRef });
  });

  it("rejects unsafe data URLs", () => {
    expect(
      resolveChatImageSource({
        source: "data:image/svg+xml,<svg onload=alert(1) />",
        cwd: "/repo",
        threadRef: undefined,
      }),
    ).toBeNull();
  });
});
