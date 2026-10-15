export class VideoEditError extends Error {}

export interface VideoMetadata {
  width: number;
  height: number;
  duration: number;
}

/** Frame coordinates are relative to the displayed, rotation-corrected video. */
export interface VideoCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VideoEdit {
  start: number;
  end: number;
  crop: VideoCrop;
}

export const VIDEO_ASPECTS = [
  { label: "Original", value: null },
  { label: "Square", value: 1 },
  { label: "Portrait", value: 4 / 5 },
  { label: "Vertical", value: 9 / 16 },
  { label: "Landscape", value: 16 / 9 },
] as const;

export function centeredVideoCrop(
  width: number,
  height: number,
  aspect: number | null,
  scale = 1,
): VideoCrop {
  if (
    ![width, height, scale].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0 ||
    scale < 0.1 ||
    scale > 1 ||
    (aspect !== null && (!Number.isFinite(aspect) || aspect <= 0))
  ) {
    throw new VideoEditError("Invalid video dimensions.");
  }
  const ratio = aspect ?? width / height;
  const cropWidth = Math.min(1, (height * ratio) / width) * scale;
  const cropHeight = Math.min(1, width / ratio / height) * scale;
  return {
    x: (1 - cropWidth) / 2,
    y: (1 - cropHeight) / 2,
    width: cropWidth,
    height: cropHeight,
  };
}

export function moveVideoCrop(
  crop: VideoCrop,
  x: number,
  y: number,
): VideoCrop {
  return {
    ...crop,
    x: Math.max(0, Math.min(1 - crop.width, x)),
    y: Math.max(0, Math.min(1 - crop.height, y)),
  };
}

export function validateVideoEdit(
  metadata: VideoMetadata,
  edit: VideoEdit,
): void {
  const { width, height, duration } = metadata;
  const { start, end, crop } = edit;
  if (
    ![
      width,
      height,
      duration,
      start,
      end,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
    ].every(Number.isFinite) ||
    width < 2 ||
    height < 2 ||
    duration <= 0
  ) {
    throw new VideoEditError(
      "This video could not be read. Choose a different file.",
    );
  }
  if (
    start < 0 ||
    end > duration + 0.001 ||
    end - start < Math.min(0.25, duration) - 0.001
  ) {
    throw new VideoEditError(
      "Choose a valid start and end time. Keep at least a quarter of a second.",
    );
  }
  if (
    crop.x < 0 ||
    crop.y < 0 ||
    crop.width <= 0 ||
    crop.height <= 0 ||
    crop.x + crop.width > 1.000001 ||
    crop.y + crop.height > 1.000001 ||
    crop.width * width < 2 ||
    crop.height * height < 2
  ) {
    throw new VideoEditError("Keep the crop frame inside the video.");
  }
}

export function videoCropPixels(
  metadata: VideoMetadata,
  crop: VideoCrop,
  maxDimension = 1080,
) {
  const left = Math.max(0, Math.floor(crop.x * metadata.width));
  const top = Math.max(0, Math.floor(crop.y * metadata.height));
  const width = Math.min(
    metadata.width - left,
    Math.floor(crop.width * metadata.width),
  );
  const height = Math.min(
    metadata.height - top,
    Math.floor(crop.height * metadata.height),
  );
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return {
    left,
    top,
    width,
    height,
    outputWidth: Math.max(2, Math.floor((width * scale) / 2) * 2),
    outputHeight: Math.max(2, Math.floor((height * scale) / 2) * 2),
  };
}

export function videoEditIsOriginal(
  metadata: VideoMetadata,
  edit: VideoEdit,
): boolean {
  return (
    edit.start === 0 &&
    Math.abs(edit.end - metadata.duration) < 0.001 &&
    edit.crop.x === 0 &&
    edit.crop.y === 0 &&
    edit.crop.width === 1 &&
    edit.crop.height === 1
  );
}
