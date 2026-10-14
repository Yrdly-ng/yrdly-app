"use client";

import React, { useEffect, useRef, useState } from "react";
import { CropSelection } from "./CropSelection";
import { VideoTrimTimeline } from "./VideoTrimTimeline";
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
  centeredVideoCrop,
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
  const [region, setRegion] = useState<VideoCrop>({
    x: 0,
    y: 0,
    width: 1,
    height: 1,
  });
  const [aspectLabel, setAspectLabel] = useState("Freeform");
  const [mode, setMode] = useState<"trim" | "crop">("trim");
  const [aspect, setAspect] = useState<number | null>(null);
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
    mounted.current = false;
    controller.current?.abort();
    videoRef.current?.pause();
    onFinish(null);
  };
  const customValid = true;

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
        <div className="rounded-xl overflow-hidden bg-black">
          {url && metadata && (
            <CropSelection
              crop={region}
              onChange={setRegion}
              sourceAspect={metadata.width / metadata.height}
              aspect={aspect}
              disabled={busy || mode !== "crop"}
              showCrop={mode === "crop"}
            >
              <video
                ref={videoRef}
                src={url}
                playsInline
                className="w-full h-full object-contain"
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onTimeUpdate={() => {
                  const video = videoRef.current;
                  if (
                    video &&
                    (video.currentTime >= end || video.currentTime < start)
                  ) {
                    video.pause();
                    video.currentTime = start;
                  }
                }}
              />
            </CropSelection>
          )}
          {!metadata && !error && (
            <div role="status" className="p-12 text-center text-white">
              Loading video…
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
              <span>{(end - start).toFixed(1)} seconds selected</span>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={mode === "trim" ? "default" : "secondary"}
                onClick={() => setMode("trim")}
              >
                Trim
              </Button>
              <Button
                type="button"
                variant={mode === "crop" ? "default" : "secondary"}
                onClick={() => setMode("crop")}
              >
                Crop
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setRegion({ x: 0, y: 0, width: 1, height: 1 });
                  setAspect(null);
                  setAspectLabel("Freeform");
                  setStart(0);
                  setEnd(metadata.duration);
                }}
              >
                Reset
              </Button>
            </div>
            {mode === "trim" ? (
              <VideoTrimTimeline
                url={url}
                duration={metadata.duration}
                start={start}
                end={end}
                disabled={busy}
                onChange={(a, b) => {
                  setStart(a);
                  setEnd(b);
                }}
                onSeek={(seconds) => {
                  if (videoRef.current) {
                    videoRef.current.pause();
                    videoRef.current.currentTime = seconds;
                  }
                }}
              />
            ) : (
              <div className="flex flex-wrap gap-2">
                {[{ label: "Freeform", value: null }, ...VIDEO_ASPECTS].map(
                  (option) => (
                    <Button
                      key={option.label}
                      type="button"
                      variant={
                        aspectLabel === option.label ? "default" : "secondary"
                      }
                      onClick={() => {
                        setAspectLabel(option.label);
                        setAspect(option.value);
                        if (option.label !== "Freeform")
                          setRegion(
                            centeredVideoCrop(
                              metadata.width,
                              metadata.height,
                              option.value,
                            ),
                          );
                      }}
                    >
                      {option.label}
                    </Button>
                  ),
                )}
              </div>
            )}
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
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
