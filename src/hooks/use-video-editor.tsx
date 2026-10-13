"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

const VideoEditDialog = dynamic(() => import("@/components/VideoEditDialog"), {
  ssr: false,
});
const ALLOWED = new Set(["video/mp4", "video/webm", "video/quicktime"]);

export function useVideoEditor() {
  const [request, setRequest] = useState<{
    file: File;
    maxBytes: number;
    id: number;
  } | null>(null);
  const pending = useRef<((file: File | null) => void) | null>(null);
  const mounted = useRef(true);
  const sequence = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pending.current?.(null);
      pending.current = null;
    };
  }, []);

  const finish = useCallback((file: File | null) => {
    const resolve = pending.current;
    pending.current = null;
    if (mounted.current) setRequest(null);
    resolve?.(file);
  }, []);

  const editVideo = useCallback(
    (file: File, maxBytes: number): Promise<File | null> => {
      if (!mounted.current || pending.current) return Promise.resolve(null);
      if (!ALLOWED.has(file.type))
        return Promise.reject(new Error("Choose an MP4, MOV or WebM video."));
      if (file.size > maxBytes)
        return Promise.reject(
          new Error(
            `Video must be under ${Math.round(maxBytes / 1024 / 1024)} MB.`,
          ),
        );
      return new Promise((resolve) => {
        pending.current = resolve;
        setRequest({ file, maxBytes, id: ++sequence.current });
      });
    },
    [],
  );

  return {
    editVideo,
    isEditingVideo: Boolean(request),
    videoEditor: request ? (
      <VideoEditDialog
        key={request.id}
        file={request.file}
        maxBytes={request.maxBytes}
        onFinish={finish}
      />
    ) : null,
  };
}
