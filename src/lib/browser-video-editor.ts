import {
  VideoEditError,
  validateVideoEdit,
  videoCropPixels,
  videoEditIsOriginal,
  type VideoEdit,
  type VideoMetadata,
} from "./video-editing";
import type { Conversion } from "mediabunny";

async function openVideo(file: File) {
  const media = await import("mediabunny");
  const input = new media.Input({
    source: new media.BlobSource(file),
    formats: media.ALL_FORMATS,
  });
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video)
      throw new VideoEditError("This file does not contain a video track.");
    const metadata = {
      width: await video.getDisplayWidth(),
      height: await video.getDisplayHeight(),
      duration: await input.computeDuration([video]),
    };
    return { media, input, video, metadata };
  } catch (error) {
    input.dispose();
    throw error;
  }
}

export async function readVideoMetadata(file: File): Promise<VideoMetadata> {
  const { input, metadata } = await openVideo(file);
  try {
    validateVideoEdit(metadata, {
      start: 0,
      end: metadata.duration,
      crop: { x: 0, y: 0, width: 1, height: 1 },
    });
    return metadata;
  } finally {
    input.dispose();
  }
}

/** Encode locally; never upload a source file just to edit it. */
export async function exportEditedVideo(
  file: File,
  edit: VideoEdit,
  options: {
    maxBytes: number;
    signal: AbortSignal;
    onProgress: (progress: number) => void;
  },
): Promise<File> {
  options.signal.throwIfAborted();
  const { media, input, video, metadata } = await openVideo(file);
  let conversion: Conversion | undefined;
  const cancel = () => {
    void conversion?.cancel().catch(() => {});
  };
  try {
    options.signal.throwIfAborted();
    validateVideoEdit(metadata, edit);
    if (videoEditIsOriginal(metadata, edit)) {
      if (file.size > options.maxBytes)
        throw new VideoEditError(
          "The original video exceeds this upload limit.",
        );
      return file;
    }
    const audio = await input.getPrimaryAudioTrack();
    const pixels = videoCropPixels(metadata, edit.crop);
    const encodeSize = {
      width: pixels.outputWidth,
      height: pixels.outputHeight,
    };
    const useMp4 =
      (await media.canEncodeVideo("avc", encodeSize)) &&
      (!audio ||
        (await media.canEncodeAudio("aac", {
          sampleRate: 48000,
          numberOfChannels: 2,
        })));
    const webmCodec =
      !useMp4 && (await media.canEncodeVideo("vp9", encodeSize))
        ? "vp9"
        : "vp8";
    if (
      !useMp4 &&
      (!(await media.canEncodeVideo(webmCodec, encodeSize)) ||
        (audio &&
          !(await media.canEncodeAudio("opus", {
            sampleRate: 48000,
            numberOfChannels: 2,
          }))))
    ) {
      throw new VideoEditError(
        "Video editing is unavailable in this browser. Try an updated Chrome or Safari.",
      );
    }
    options.signal.throwIfAborted();
    const target = new media.BufferTarget();
    target.on("write", ({ end }) => {
      if (end > options.maxBytes)
        throw new VideoEditError(
          "The edited video is too large. Try a shorter clip or smaller frame.",
        );
    });
    const output = new media.Output({
      format: useMp4
        ? new media.Mp4OutputFormat()
        : new media.WebMOutputFormat(),
      target,
    });
    const duration = edit.end - edit.start;
    const bitrate = Math.max(
      128000,
      Math.min(
        4000000,
        (file.size * 8) / metadata.duration,
        (options.maxBytes * 8 * 0.85) / duration - 96000,
      ),
    );
    conversion = await media.Conversion.init({
      input,
      output,
      tracks: "primary",
      tags: {},
      showWarnings: false,
      trim: { start: edit.start, end: edit.end },
      video: {
        crop: {
          left: pixels.left,
          top: pixels.top,
          width: pixels.width,
          height: pixels.height,
        },
        width: pixels.outputWidth,
        height: pixels.outputHeight,
        fit: "fill",
        codec: useMp4 ? "avc" : webmCodec,
        quality: new media.Quality({ bitrate }),
        allowTransformationMetadata: false,
      },
      audio: {
        codec: useMp4 ? "aac" : "opus",
        sampleRate: 48000,
        numberOfChannels: 2,
        quality: new media.Quality({ bitrate: 96000 }),
      },
    });
    // A valid video with discarded audio is still valid to the library. Never silently mute it.
    if (
      !conversion.isValid ||
      !conversion.utilizedTracks.includes(video) ||
      (audio && !conversion.utilizedTracks.includes(audio))
    ) {
      throw new VideoEditError(
        "This browser cannot edit this video while preserving its sound. Try a different file or browser.",
      );
    }
    conversion.onProgress = (progress) =>
      options.onProgress(Math.max(0, Math.min(1, progress)));
    options.signal.addEventListener("abort", cancel, { once: true });
    options.signal.throwIfAborted();
    await conversion.execute();
    options.signal.throwIfAborted();
    if (
      !target.buffer ||
      target.buffer.byteLength === 0 ||
      target.buffer.byteLength > options.maxBytes
    ) {
      throw new VideoEditError(
        "The edited video could not be saved within the upload limit. Try a shorter clip.",
      );
    }
    const extension = useMp4 ? "mp4" : "webm";
    return new File(
      [target.buffer],
      `${file.name.replace(/\.[^.]+$/, "") || "video"}-edited.${extension}`,
      { type: `video/${extension}`, lastModified: Date.now() },
    );
  } finally {
    options.signal.removeEventListener("abort", cancel);
    if (conversion && conversion.state !== "done")
      await conversion.cancel().catch(() => {});
    input.dispose();
  }
}
