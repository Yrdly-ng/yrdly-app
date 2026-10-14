"use client";

import React, { useEffect, useRef, useState } from "react";
import type { Area } from "react-easy-crop";
import { CropSelection } from "./CropSelection";
import { centeredVideoCrop, type VideoCrop } from "@/lib/video-editing";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const ASPECTS = [
  { label: "1:1", value: 1 },
  { label: "4:5", value: 4 / 5 },
  { label: "16:9", value: 16 / 9 },
];

const MAX_OUTPUT_SIDE = 2048;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = src;
  });
}

async function cropToFile(
  src: string,
  area: Area,
  original: File,
): Promise<File> {
  const img = await loadImage(src);

  const scale = Math.min(
    1,
    MAX_OUTPUT_SIDE / Math.max(area.width, area.height),
  );
  const outW = Math.round(area.width * scale);
  const outH = Math.round(area.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");

  ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, outW, outH);

  const keepType = ["image/png", "image/webp"].includes(original.type);
  const type = keepType ? original.type : "image/jpeg";

  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Crop failed"))),
      type,
      0.92,
    ),
  );

  const ext =
    type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  const base = original.name.replace(/\.[^.]+$/, "") || "image";
  return new File([blob], `${base}-cropped.${ext}`, { type });
}

interface ImageCropDialogProps {
  /** The file being cropped. Pass null to close the dialog. */
  file: File | null;
  /** Called with the cropped file. */
  onConfirm: (cropped: File) => void;
  /** Keep the image exactly as picked. */
  onUseOriginal: (original: File) => void;
  /** Discard this image. */
  onCancel: () => void;
  /** Shown as "Photo 2 of 5" when cropping a batch. */
  progressLabel?: string;
}

export default function ImageCropDialog({
  file,
  onConfirm,
  onUseOriginal,
  onCancel,
  progressLabel,
}: ImageCropDialogProps) {
  const [src, setSrc] = useState("");
  const [dimensions, setDimensions] = useState({ width: 1, height: 1 });
  const [crop, setCrop] = useState<VideoCrop>({
    x: 0,
    y: 0,
    width: 1,
    height: 1,
  });
  const [aspect, setAspect] = useState<number | null>(null);
  const [working, setWorking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const sourceRevision = useRef(0);
  const ready = useRef(false);
  useEffect(() => {
    if (!file) return;
    let active = true;
    const revision = ++sourceRevision.current;
    ready.current = false;
    setLoading(true);
    setWorking(false);
    const url = URL.createObjectURL(file);
    setSrc(url);
    setCrop({ x: 0, y: 0, width: 1, height: 1 });
    setAspect(null);
    setError("");
    void loadImage(url)
      .then((image) => {
        if (active && revision === sourceRevision.current) {
          setDimensions({
            width: image.naturalWidth,
            height: image.naturalHeight,
          });
          ready.current = true;
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setError("Could not open this photo.");
          setLoading(false);
        }
      });
    return () => {
      active = false;
      sourceRevision.current++;
      ready.current = false;
      URL.revokeObjectURL(url);
    };
  }, [file]);
  async function confirm() {
    if (!file || working || !ready.current) return;
    const revision = sourceRevision.current;
    setWorking(true);
    setError("");
    try {
      const output = await cropToFile(
        src,
        {
          x: crop.x * dimensions.width,
          y: crop.y * dimensions.height,
          width: crop.width * dimensions.width,
          height: crop.height * dimensions.height,
        },
        file,
      );
      if (revision === sourceRevision.current) onConfirm(output);
    } catch {
      setError("Could not save this crop. Your original photo is safe.");
    } finally {
      if (revision === sourceRevision.current) setWorking(false);
    }
  }
  return (
    <Dialog
      open={!!file}
      onOpenChange={(open) => {
        if (!open && !working) onCancel();
      }}
    >
      <DialogContent className="max-w-2xl gap-4">
        <DialogHeader>
          <DialogTitle>Crop photo</DialogTitle>
          <DialogDescription>
            {progressLabel} Drag the edges to crop, pinch to zoom, or drag the
            frame to reposition.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div role="status" className="flex justify-center p-12">
            <Loader2 className="animate-spin" aria-label="Opening photo" />
          </div>
        ) : (
          <CropSelection
            crop={crop}
            onChange={setCrop}
            aspect={aspect}
            sourceAspect={dimensions.width / dimensions.height}
            disabled={working || !!error}
          >
            <img
              src={src}
              alt="Photo to crop"
              className="w-full h-full object-contain"
            />
          </CropSelection>
        )}
        <div className="flex flex-wrap gap-2">
          {[
            { label: "Freeform", value: null },
            { label: "Original", value: dimensions.width / dimensions.height },
            ...ASPECTS,
            { label: "9:16", value: 9 / 16 },
          ].map((option) => (
            <Button
              key={option.label}
              type="button"
              variant={aspect === option.value ? "default" : "secondary"}
              disabled={working}
              onClick={() => {
                setAspect(option.value);
                setCrop(
                  centeredVideoCrop(
                    dimensions.width,
                    dimensions.height,
                    option.value,
                  ),
                );
              }}
            >
              {option.label}
            </Button>
          ))}
        </div>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" disabled={working} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            disabled={working}
            onClick={() => {
              setCrop({ x: 0, y: 0, width: 1, height: 1 });
              setAspect(null);
            }}
          >
            Reset
          </Button>
          <Button
            variant="outline"
            disabled={working}
            onClick={() => file && onUseOriginal(file)}
          >
            Keep original
          </Button>
          <Button
            disabled={working || loading || !ready.current}
            onClick={() => void confirm()}
          >
            {working ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
