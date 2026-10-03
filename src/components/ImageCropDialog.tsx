"use client";

import React, { useCallback, useEffect, useState } from "react";
import Cropper, { Area } from "react-easy-crop";
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
import { cn } from "@/lib/utils";

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

async function cropToFile(src: string, area: Area, original: File): Promise<File> {
  const img = await loadImage(src);

  const scale = Math.min(1, MAX_OUTPUT_SIDE / Math.max(area.width, area.height));
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
      0.92
    )
  );

  const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
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
  const [src, setSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [aspect, setAspect] = useState(ASPECTS[0].value);
  const [pixels, setPixels] = useState<Area | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create / revoke the object URL for the current file
  useEffect(() => {
    if (!file) {
      setSrc(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setSrc(url);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setAspect(ASPECTS[0].value);
    setPixels(null);
    setError(null);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const onCropComplete = useCallback((_: Area, areaPixels: Area) => {
    setPixels(areaPixels);
  }, []);

  const handleConfirm = async () => {
    if (!file || !src || !pixels) return;
    setWorking(true);
    setError(null);
    try {
      const cropped = await cropToFile(src, pixels, file);
      onConfirm(cropped);
    } catch (e: any) {
      setError(e?.message || "Could not crop this image.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog open={!!file} onOpenChange={(open) => !open && !working && onCancel()}>
      <DialogContent className="max-w-lg p-0 overflow-hidden gap-0">
        <DialogHeader className="px-4 pt-4 pb-3">
          <DialogTitle>Crop photo</DialogTitle>
          <DialogDescription>
            {progressLabel ? `${progressLabel} · ` : ""}Drag to reposition, pinch or use the slider to zoom.
          </DialogDescription>
        </DialogHeader>

        <div className="relative w-full h-[55vh] max-h-[420px] bg-black">
          {src && (
            <Cropper
              image={src}
              crop={crop}
              zoom={zoom}
              aspect={aspect}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
              objectFit="contain"
            />
          )}
        </div>

        <div className="px-4 py-3 space-y-3">
          <div className="flex items-center gap-2">
            {ASPECTS.map((a) => (
              <button
                key={a.label}
                type="button"
                onClick={() => setAspect(a.value)}
                className={cn(
                  "px-3 py-1 rounded-full text-xs font-semibold transition-colors",
                  aspect === a.value
                    ? "bg-primary text-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                )}
              >
                {a.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground w-9">Zoom</span>
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="flex-1 accent-primary"
              aria-label="Zoom"
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter className="px-4 pb-4 gap-2 sm:gap-2">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={working}>
            Discard
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => file && onUseOriginal(file)}
            disabled={working}
          >
            Use original
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={working || !pixels}
            className="bg-primary text-foreground font-bold hover:bg-primary/90"
          >
            {working ? <Loader2 className="w-4 h-4 animate-spin" /> : "Crop"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
