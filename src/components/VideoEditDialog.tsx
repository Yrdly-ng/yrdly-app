"use client";

import React, { useEffect, useRef, useState } from "react";
import Cropper from "react-easy-crop";
import { Loader2, Play, Pause, Scissors, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  readVideoMetadata,
  exportEditedVideo,
} from "@/lib/browser-video-editor";
import {
  VideoEditError,
  VIDEO_ASPECTS,
  videoCropPixels,
  type VideoCrop,
  type VideoMetadata,
} from "@/lib/video-editing";

interface Props {
  file: File;
  maxBytes: number;
  onFinish: (file: File | null) => void;
}

export default function VideoEditDialog({ file, maxBytes, onFinish }: Props) {
  const [url, setUrl] = useState("");
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [region, setRegion] = useState<VideoCrop>({
    x: 0,
    y: 0,
    width: 1,
    height: 1,
  });
  const [zoom, setZoom] = useState(1);
  const [aspectLabel, setAspectLabel] = useState("Original");
  const [aspect, setAspect] = useState<number | null>(null);
  const [customWidth, setCustomWidth] = useState("1");
  const [customHeight, setCustomHeight] = useState("1");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    void readVideoMetadata(file)
      .then((data) => {
        if (!mounted.current) return;
        setMetadata(data);
        setEnd(data.duration);
        setCustomWidth(String(data.width));
        setCustomHeight(String(data.height));
      })
      .catch(() => {
        if (mounted.current)
          setError(
            "This browser could not read the video. Try a different file or keep the original.",
          );
      });
    return () => {
      mounted.current = false;
      controller.current?.abort();
      videoRef.current?.pause();
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  const cancel = () => {
    controller.current?.abort();
    videoRef.current?.pause();
    onFinish(null);
  };
  const minimum = metadata ? Math.min(0.25, metadata.duration) : 0.25;
  const pixels = metadata ? videoCropPixels(metadata, region) : null;
  const customAspect = Number(customWidth) / Number(customHeight);
  const customValid =
    aspectLabel !== "Custom" ||
    (Number(customWidth) > 0 &&
      Number(customHeight) > 0 &&
      Number.isFinite(customAspect) &&
      customAspect >= 0.1 &&
      customAspect <= 10);
  const previewAspect =
    aspectLabel === "Custom" && customValid
      ? customAspect
      : (aspect ?? (metadata ? metadata.width / metadata.height : 16 / 9));

  async function apply() {
    if (!metadata || busy || controller.current || !customValid) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setProgress(0);
    setError("");
    videoRef.current?.pause();
    try {
      const edited = await exportEditedVideo(
        file,
        { start, end, crop: region },
        {
          maxBytes,
          signal: abort.signal,
          onProgress: (value) => {
            if (mounted.current) setProgress(value);
          },
        },
      );
      if (mounted.current && !abort.signal.aborted) onFinish(edited);
    } catch (failure) {
      if (mounted.current && !abort.signal.aborted)
        setError(
          failure instanceof VideoEditError
            ? failure.message
            : "Could not prepare this video. Try a shorter clip or another file.",
        );
    } finally {
      controller.current = null;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) cancel();
      }}
    >
      <DialogContent
        hideClose
        className="max-w-2xl max-h-[94dvh] overflow-y-auto p-4 sm:p-6 gap-4"
        aria-describedby="video-editor-description"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Scissors className="h-5 w-5 text-primary" /> Edit video
            </DialogTitle>
            <DialogDescription id="video-editor-description" className="mt-1">
              Trim your clip and drag the frame to keep what matters.
            </DialogDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Cancel video editing"
            onClick={cancel}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
        <div
          className="relative h-56 sm:h-72 rounded-2xl overflow-hidden bg-black"
          aria-label="Video crop preview"
        >
          {url && metadata && (
            <Cropper
              video={url}
              crop={crop}
              zoom={zoom}
              aspect={previewAspect}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(area) =>
                setRegion({
                  x: Math.max(0, area.x / 100),
                  y: Math.max(0, area.y / 100),
                  width: Math.min(1, area.width / 100),
                  height: Math.min(1, area.height / 100),
                })
              }
              setVideoRef={(ref) => {
                videoRef.current = ref.current;
              }}
              mediaProps={{
                autoPlay: false,
                muted: false,
                playsInline: true,
                onPlay: () => setPlaying(true),
                onPause: () => setPlaying(false),
                onTimeUpdate: () => {
                  const video = videoRef.current;
                  if (
                    video &&
                    (video.currentTime >= end || video.currentTime < start)
                  ) {
                    video.pause();
                    video.currentTime = start;
                  }
                },
              }}
              style={{
                cropAreaStyle: {
                  borderColor: "hsl(var(--primary))",
                  borderWidth: 2,
                },
              }}
            />
          )}
          {!metadata && !error && (
            <div
              className="absolute inset-0 grid place-items-center text-white"
              role="status"
            >
              <Loader2 className="h-7 w-7 animate-spin" />
              <span className="sr-only">Loading video</span>
            </div>
          )}
        </div>
        {metadata && (
          <fieldset disabled={busy} className="space-y-4 min-w-0">
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  const video = videoRef.current;
                  if (!video) return;
                  if (video.paused) {
                    if (video.currentTime < start || video.currentTime >= end)
                      video.currentTime = start;
                    void video
                      .play()
                      .catch(() =>
                        setError("Tap preview again to play this video."),
                      );
                  } else video.pause();
                }}
              >
                {playing ? (
                  <Pause className="mr-1 h-4 w-4" />
                ) : (
                  <Play className="mr-1 h-4 w-4" />
                )}
                Preview clip
              </Button>
              <span>
                {(end - start).toFixed(2)}s · {pixels?.outputWidth} ×{" "}
                {pixels?.outputHeight}px
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <label className="space-y-2 text-xs font-semibold">
                Start (seconds)
                <input
                  aria-label="Trim start"
                  type="range"
                  min={0}
                  max={metadata.duration}
                  step="0.01"
                  value={start}
                  onChange={(event) => {
                    const value = Math.max(
                      0,
                      Math.min(Number(event.target.value), end - minimum),
                    );
                    setStart(value);
                    if (videoRef.current) videoRef.current.currentTime = value;
                  }}
                  className="w-full accent-primary"
                />
                <input
                  aria-label="Start seconds"
                  type="number"
                  min={0}
                  max={end - minimum}
                  step="0.01"
                  value={Number(start.toFixed(2))}
                  onChange={(event) => {
                    const value = Math.max(
                      0,
                      Math.min(Number(event.target.value), end - minimum),
                    );
                    setStart(value);
                    if (videoRef.current) videoRef.current.currentTime = value;
                  }}
                  className="w-full rounded-xl border border-border bg-secondary p-2 text-sm"
                />
              </label>
              <label className="space-y-2 text-xs font-semibold">
                End (seconds)
                <input
                  aria-label="Trim end"
                  type="range"
                  min={0}
                  max={metadata.duration}
                  step="0.01"
                  value={end}
                  onChange={(event) =>
                    setEnd(
                      Math.min(
                        metadata.duration,
                        Math.max(Number(event.target.value), start + minimum),
                      ),
                    )
                  }
                  className="w-full accent-primary"
                />
                <input
                  aria-label="End seconds"
                  type="number"
                  min={start + minimum}
                  max={metadata.duration}
                  step="0.01"
                  value={Number(end.toFixed(2))}
                  onChange={(event) =>
                    setEnd(
                      Math.min(
                        metadata.duration,
                        Math.max(Number(event.target.value), start + minimum),
                      ),
                    )
                  }
                  className="w-full rounded-xl border border-border bg-secondary p-2 text-sm"
                />
              </label>
            </div>
            <div
              className="flex flex-wrap gap-2"
              aria-label="Video frame shape"
            >
              {VIDEO_ASPECTS.map((option) => (
                <Button
                  type="button"
                  size="sm"
                  key={option.label}
                  variant={
                    aspectLabel === option.label ? "default" : "secondary"
                  }
                  aria-pressed={aspectLabel === option.label}
                  onClick={() => {
                    setAspectLabel(option.label);
                    setAspect(option.value);
                    setZoom(1);
                    setCrop({ x: 0, y: 0 });
                  }}
                >
                  {option.label}
                </Button>
              ))}
              <Button
                type="button"
                size="sm"
                variant={aspectLabel === "Custom" ? "default" : "secondary"}
                aria-pressed={aspectLabel === "Custom"}
                onClick={() => {
                  setAspectLabel("Custom");
                  setZoom(1);
                  setCrop({ x: 0, y: 0 });
                }}
              >
                Custom
              </Button>
            </div>
            {aspectLabel === "Custom" && (
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs">
                  Ratio width
                  <input
                    aria-label="Custom ratio width"
                    type="number"
                    min={1}
                    value={customWidth}
                    onChange={(event) => setCustomWidth(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-border bg-secondary p-2"
                  />
                </label>
                <label className="text-xs">
                  Ratio height
                  <input
                    aria-label="Custom ratio height"
                    type="number"
                    min={1}
                    value={customHeight}
                    onChange={(event) => setCustomHeight(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-border bg-secondary p-2"
                  />
                </label>
              </div>
            )}
            <label className="block space-y-2 text-xs font-semibold">
              Zoom to crop
              <input
                aria-label="Video crop zoom"
                type="range"
                min={1}
                max={4}
                step="0.01"
                value={zoom}
                onChange={(event) => setZoom(Number(event.target.value))}
                className="block w-full accent-primary"
              />
            </label>
            <div
              className="flex justify-center gap-2"
              aria-label="Adjust crop position"
            >
              {(
                [
                  ["Left", -10, 0],
                  ["Up", 0, -10],
                  ["Down", 0, 10],
                  ["Right", 10, 0],
                ] as const
              ).map(([label, x, y]) => (
                <Button
                  key={label}
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`Move crop ${label.toLowerCase()}`}
                  onClick={() =>
                    setCrop((value) => ({ x: value.x - x, y: value.y - y }))
                  }
                >
                  {label}
                </Button>
              ))}
            </div>
          </fieldset>
        )}
        {!customValid && (
          <p role="alert" className="text-sm text-destructive">
            Enter a positive ratio between 1:10 and 10:1.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {busy && (
          <div role="status" className="space-y-2 text-sm">
            <span>Preparing video… {Math.round(progress * 100)}%</span>
            <progress
              aria-label="Video export progress"
              value={progress}
              max={1}
              className="w-full accent-primary"
            />
          </div>
        )}
        <div className="grid grid-cols-3 gap-2 border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={cancel}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={busy || file.size > maxBytes}
            onClick={() => onFinish(file)}
          >
            Keep original
          </Button>
          <Button
            type="button"
            disabled={!metadata || busy || !customValid}
            onClick={() => void apply()}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Apply edits"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
