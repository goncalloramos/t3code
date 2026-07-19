import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ChatImage } from "./ChatImage";

describe("ChatImage", () => {
  it("renders safe inline image data", () => {
    const markup = renderToStaticMarkup(
      <ChatImage
        source="data:image/png;base64,aW1hZ2U="
        alt="Generated preview"
        cwd={undefined}
        threadRef={undefined}
      />,
    );

    expect(markup).toContain('src="data:image/png;base64,aW1hZ2U="');
    expect(markup).toContain('alt="Generated preview"');
  });

  it("does not render unsafe image data", () => {
    const markup = renderToStaticMarkup(
      <ChatImage
        source="data:image/svg+xml,&lt;svg onload=alert(1)&gt;"
        alt="Unsafe preview"
        cwd={undefined}
        threadRef={undefined}
      />,
    );

    expect(markup).not.toContain("<img");
    expect(markup).toContain("Unable to resolve Unsafe preview");
  });
});
