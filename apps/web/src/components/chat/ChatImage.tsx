import type { ScopedThreadRef } from "@t3tools/contracts";
import { memo, useMemo, useState } from "react";

import { useAssetUrlState } from "~/assets/assetUrls";
import { resolveChatImageSource } from "~/chatImageSources";
import { cn } from "~/lib/utils";

interface ChatImageProps {
  readonly source: string;
  readonly alt: string;
  readonly cwd: string | undefined;
  readonly threadRef: ScopedThreadRef | undefined;
  readonly className?: string;
  readonly onExpand?: ((resolvedSource: string) => void) | undefined;
}

interface ResolvedImageProps {
  readonly source: string;
  readonly alt: string;
  readonly className?: string;
  readonly onExpand?: ((resolvedSource: string) => void) | undefined;
}

const ResolvedImage = memo(function ResolvedImage(props: ResolvedImageProps) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  if (failedSource === props.source) {
    return (
      <span className="flex min-h-20 items-center justify-center rounded-lg border border-border/80 bg-muted/20 px-3 py-4 text-center text-xs text-muted-foreground">
        Unable to display {props.alt}
      </span>
    );
  }

  const image = (
    <img
      src={props.source}
      alt={props.alt}
      loading="lazy"
      draggable={false}
      className={cn("block h-auto max-h-[560px] w-auto max-w-full object-contain", props.className)}
      onError={() => setFailedSource(props.source)}
    />
  );

  if (!props.onExpand) return image;
  return (
    <button
      type="button"
      className="block max-w-full cursor-zoom-in"
      aria-label={`Preview ${props.alt}`}
      onClick={() => props.onExpand?.(props.source)}
    >
      {image}
    </button>
  );
});

function WorkspaceChatImage(
  props: Omit<ChatImageProps, "source" | "threadRef"> & {
    readonly path: string;
    readonly threadRef: ScopedThreadRef;
  },
) {
  const resource = useMemo(
    () => ({
      _tag: "workspace-file" as const,
      threadId: props.threadRef.threadId,
      path: props.path,
    }),
    [props.path, props.threadRef.threadId],
  );
  const source = useAssetUrlState(props.threadRef.environmentId, resource);
  if (source.status === "failed") {
    return (
      <span className="flex min-h-20 items-center justify-center rounded-lg border border-border/80 bg-muted/20 px-3 py-4 text-center text-xs text-muted-foreground">
        Unable to display {props.alt}
      </span>
    );
  }
  if (source.status === "loading") {
    return (
      <span className="flex min-h-20 items-center justify-center rounded-lg border border-border/80 bg-muted/20 px-3 py-4 text-center text-xs text-muted-foreground">
        Loading {props.alt}…
      </span>
    );
  }
  return <ResolvedImage {...props} source={source.url} />;
}

export const ChatImage = memo(function ChatImage(props: ChatImageProps) {
  const resolved = resolveChatImageSource(props);
  if (!resolved) {
    return (
      <span className="flex min-h-20 items-center justify-center rounded-lg border border-border/80 bg-muted/20 px-3 py-4 text-center text-xs text-muted-foreground">
        Unable to resolve {props.alt}
      </span>
    );
  }
  if (resolved.kind === "direct") {
    return <ResolvedImage {...props} source={resolved.url} />;
  }
  return <WorkspaceChatImage {...props} path={resolved.path} threadRef={resolved.threadRef} />;
});
