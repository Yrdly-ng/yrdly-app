"use client";
import { useEffect, useRef, useState } from "react";
export function VideoTrimTimeline({
  url,
  duration,
  start,
  end,
  onChange,
  onSeek,
  disabled,
}: {
  url: string;
  duration: number;
  start: number;
  end: number;
  disabled?: boolean;
  onChange: (start: number, end: number) => void;
  onSeek: (seconds: number) => void;
}) {
  const [frames, setFrames] = useState<string[]>([]);
  const drag = useRef<"start" | "end" | null>(null);
  const track = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.playsInline = true;
    const canvas = document.createElement("canvas");
    canvas.width = 140;
    canvas.height = 90;
    const results: string[] = [];
    const wait = (event: string) =>
      new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timeout);
          video.removeEventListener(event, ready);
          video.removeEventListener("error", failed);
        };
        const ready = () => {
            cleanup();
            resolve();
          },
          failed = () => {
            cleanup();
            reject(new Error("Thumbnail unavailable"));
          };
        const timeout = setTimeout(failed, 10000);
        video.addEventListener(event, ready, { once: true });
        video.addEventListener("error", failed, { once: true });
      });
    void (async () => {
      const loaded = wait("loadeddata");
      video.src = url;
      await loaded;
      for (let index = 0; index < 8 && active; index++) {
        const seconds = Math.min(
          duration - 0.01,
          (duration * (index + 0.5)) / 8,
        );
        const seeked = wait("seeked");
        video.currentTime = Math.max(0, seconds);
        await seeked;
        if (!active) break;
        canvas.getContext("2d")?.drawImage(video, 0, 0, 140, 90);
        results.push(canvas.toDataURL("image/jpeg", 0.65));
        setFrames([...results]);
      }
    })().catch(() => {});
    return () => {
      active = false;
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [url, duration]);
  const change = (edge: "start" | "end", value: number) => {
    const minimum = Math.min(0.25, duration);
    const a =
      edge === "start" ? Math.max(0, Math.min(end - minimum, value)) : start;
    const b =
      edge === "end"
        ? Math.min(duration, Math.max(start + minimum, value))
        : end;
    onChange(a, b);
    onSeek(edge === "start" ? a : Math.max(a, b - minimum));
  };
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{start.toFixed(1)}s</span>
        <span>{(end - start).toFixed(1)}s selected</span>
        <span>{end.toFixed(1)}s</span>
      </div>
      <div
        ref={track}
        className="relative h-16 rounded-lg bg-secondary select-none"
        style={{ touchAction: "none" }}
        onPointerMove={(event) => {
          if (!drag.current || disabled) return;
          const rect = track.current!.getBoundingClientRect();
          change(
            drag.current,
            ((event.clientX - rect.left) / rect.width) * duration,
          );
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <div className="absolute inset-1 rounded overflow-hidden flex">
          {frames.map((src, index) => (
            <img
              key={index}
              src={src}
              alt=""
              className="flex-1 min-w-0 h-full object-cover"
            />
          ))}
        </div>
        <div
          className="absolute inset-y-1 left-0 bg-black/60 pointer-events-none"
          style={{ width: `${(start / duration) * 100}%` }}
        />
        <div
          className="absolute inset-y-1 right-0 bg-black/60 pointer-events-none"
          style={{ width: `${(1 - end / duration) * 100}%` }}
        />
        {(["start", "end"] as const).map((edge) => (
          <button
            type="button"
            key={edge}
            disabled={disabled}
            role="slider"
            aria-label={`Trim ${edge}`}
            aria-valuemin={0}
            aria-valuemax={duration}
            aria-valuenow={edge === "start" ? start : end}
            className="absolute inset-y-0 w-6 bg-primary rounded-md flex items-center justify-center"
            style={{
              left: `clamp(0px, calc(${((edge === "start" ? start : end) / duration) * 100}% - 12px), calc(100% - 24px))`,
            }}
            onPointerDown={(event) => {
              drag.current = edge;
              track.current?.setPointerCapture(event.pointerId);
              event.preventDefault();
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                change(
                  edge,
                  (edge === "start" ? start : end) +
                    (event.key === "ArrowLeft" ? -0.1 : 0.1),
                );
              }
            }}
          >
            <span className="h-6 w-1 bg-black/60 rounded" />
          </button>
        ))}
      </div>
    </div>
  );
}
