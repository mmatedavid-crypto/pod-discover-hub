import { forwardRef } from "react";

type Props = {
  src: string;
  title: string;
};

export const InlineAudioPlayer = forwardRef<HTMLAudioElement, Props>(function InlineAudioPlayer(
  { src, title },
  ref,
) {
  return (
    <div className="mt-5 rounded-xl border border-border bg-card/60 p-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2 px-1">
        Preview · {title.slice(0, 60)}
      </div>
      <audio
        ref={ref}
        controls
        preload="none"
        src={src}
        className="w-full h-10"
      >
        Your browser does not support audio playback.
      </audio>
    </div>
  );
});
