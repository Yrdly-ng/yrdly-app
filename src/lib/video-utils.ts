/**
 * Video utilities — thumbnail generation, validation, and format helpers.
 */

import { FILE_CONSTANTS } from './constants';

/**
 * Generate a JPEG thumbnail from the first seekable frame of a video file.
 * Returns a base64 data URL, or null if generation fails.
 */
export function generateVideoThumbnail(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const objectUrl = URL.createObjectURL(file);
    video.src = objectUrl;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';

    const cleanup = () => URL.revokeObjectURL(objectUrl);

    video.addEventListener('loadeddata', () => {
      // Seek slightly into the clip so we don't get a black frame
      video.currentTime = Math.min(0.5, video.duration * 0.1);
    });

    video.addEventListener('seeked', () => {
      try {
        const canvas = document.createElement('canvas');
        const MAX_W = 640;
        const scale = Math.min(1, MAX_W / video.videoWidth);
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) { cleanup(); resolve(null); return; }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      } catch {
        resolve(null);
      } finally {
        cleanup();
      }
    });

    video.addEventListener('error', () => { cleanup(); resolve(null); });

    // Timeout guard — some formats don't fire seeked reliably
    setTimeout(() => { cleanup(); resolve(null); }, 8000);
  });
}

/**
 * Returns an error string if the file is invalid, or null if it passes.
 */
export function validateVideoFile(file: File): string | null {
  if (!FILE_CONSTANTS.ALLOWED_VIDEO_TYPES.includes(file.type)) {
    return 'Only MP4, WebM, and MOV videos are supported.';
  }
  if (file.size > FILE_CONSTANTS.MAX_VIDEO_SIZE) {
    const maxMb = Math.round(FILE_CONSTANTS.MAX_VIDEO_SIZE / (1024 * 1024));
    return `Video must be under ${maxMb} MB. Try trimming or compressing it first.`;
  }
  return null;
}

/**
 * Format a duration in seconds to mm:ss or hh:mm:ss.
 */
export function formatVideoDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Read a video file's duration in seconds.
 */
export function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    video.src = url;
    video.preload = 'metadata';
    video.addEventListener('loadedmetadata', () => {
      resolve(video.duration);
      URL.revokeObjectURL(url);
    });
    video.addEventListener('error', () => { resolve(0); URL.revokeObjectURL(url); });
  });
}
