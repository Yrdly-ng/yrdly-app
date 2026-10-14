"use client";
import { useRef, type ReactNode } from "react";
import type { VideoCrop } from "@/lib/video-editing";
const handles = ["nw", "n", "ne", "w", "e", "sw", "s", "se"] as const;
export function CropSelection({
  children,
  crop,
  onChange,
  sourceAspect,
  aspect,
  disabled,
  showCrop = true,
}: {
  children: ReactNode;
  crop: VideoCrop;
  onChange: (crop: VideoCrop) => void;
  sourceAspect: number;
  aspect?: number | null;
  disabled?: boolean;
  showCrop?: boolean;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    crop: VideoCrop;
    x: number;
    y: number;
    handle: string;
    distance: number;
  } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  function change(dx: number, dy: number, handle: string, initial: VideoCrop) {
    let left = initial.x,
      top = initial.y,
      right = left + initial.width,
      bottom = top + initial.height;
    if (handle === "move") {
      left = Math.max(0, Math.min(1 - initial.width, left + dx));
      top = Math.max(0, Math.min(1 - initial.height, top + dy));
      onChange({ ...initial, x: left, y: top });
      return;
    }
    if (handle.includes("w"))
      left = Math.max(0, Math.min(right - 0.02, left + dx));
    if (handle.includes("e"))
      right = Math.min(1, Math.max(left + 0.02, right + dx));
    if (handle.includes("n"))
      top = Math.max(0, Math.min(bottom - 0.02, top + dy));
    if (handle.includes("s"))
      bottom = Math.min(1, Math.max(top + 0.02, bottom + dy));
    if (aspect) {
      const ratio = aspect / sourceAspect;
      if (handle === "n" || handle === "s")
        right = left + (bottom - top) * ratio;
      else bottom = top + (right - left) / ratio;
      if (right > 1 || bottom > 1) return;
    }
    onChange({ x: left, y: top, width: right - left, height: bottom - top });
  }
  return (
    <div
      ref={frame}
      className="relative overflow-hidden mx-auto w-full select-none"
      style={{
        aspectRatio: sourceAspect,
        maxWidth: `${Math.min(900, 380 * sourceAspect)}px`,
        touchAction: "none",
      }}
      onPointerDown={(event) => {
        if (disabled) return;
        const rect = frame.current!.getBoundingClientRect();
        pointers.current.set(event.pointerId, {
          x: event.clientX,
          y: event.clientY,
        });
        event.currentTarget.setPointerCapture(event.pointerId);
        const points = [...pointers.current.values()];
        drag.current = {
          crop,
          x: event.clientX / rect.width,
          y: event.clientY / rect.height,
          handle:
            (event.target as HTMLElement).closest<HTMLElement>(
              "[data-crop-handle]",
            )?.dataset.cropHandle || "move",
          distance:
            points.length > 1
              ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)
              : 0,
        };
      }}
      onPointerMove={(event) => {
        const state = drag.current,
          rect = frame.current?.getBoundingClientRect();
        if (!state || !rect || disabled) return;
        if (!pointers.current.has(event.pointerId)) return;
        pointers.current.set(event.pointerId, {
          x: event.clientX,
          y: event.clientY,
        });
        const points = [...pointers.current.values()];
        if (points.length > 1 && state.distance > 0) {
          const distance = Math.hypot(
            points[0].x - points[1].x,
            points[0].y - points[1].y,
          );
          const factor = Math.max(
            0.05 / Math.min(state.crop.width, state.crop.height),
            Math.min(
              1 / Math.max(state.crop.width, state.crop.height),
              state.distance / Math.max(1, distance),
            ),
          );
          const w = state.crop.width * factor,
            h = state.crop.height * factor;
          onChange({
            x: Math.max(
              0,
              Math.min(1 - w, state.crop.x + (state.crop.width - w) / 2),
            ),
            y: Math.max(
              0,
              Math.min(1 - h, state.crop.y + (state.crop.height - h) / 2),
            ),
            width: w,
            height: h,
          });
        } else
          change(
            event.clientX / rect.width - state.x,
            event.clientY / rect.height - state.y,
            state.handle,
            state.crop,
          );
      }}
      onPointerUp={(event) => {
        pointers.current.delete(event.pointerId);
        drag.current = null;
      }}
      onPointerCancel={() => {
        pointers.current.clear();
        drag.current = null;
      }}
    >
      {children}
      {showCrop && (
        <div
          className="absolute border-2 border-[#82DB7E]"
          style={{
            left: `${crop.x * 100}%`,
            top: `${crop.y * 100}%`,
            width: `${crop.width * 100}%`,
            height: `${crop.height * 100}%`,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.5)",
          }}
        >
          {[1, 2].map((index) => (
            <span key={index} className="absolute inset-0 pointer-events-none">
              <span
                className="absolute inset-y-0 w-px bg-white/40"
                style={{ left: `${(index * 100) / 3}%` }}
              />
              <span
                className="absolute inset-x-0 h-px bg-white/40"
                style={{ top: `${(index * 100) / 3}%` }}
              />
            </span>
          ))}
          {handles.map((handle) => (
            <button
              key={handle}
              type="button"
              data-crop-handle={handle}
              disabled={disabled}
              aria-label={`Resize crop ${handle}`}
              className="absolute w-10 h-10 flex items-center justify-center -translate-x-1/2 -translate-y-1/2"
              style={{
                left: handle.includes("w")
                  ? "0%"
                  : handle.includes("e")
                    ? "100%"
                    : "50%",
                top: handle.includes("n")
                  ? "0%"
                  : handle.includes("s")
                    ? "100%"
                    : "50%",
              }}
              onKeyDown={(event) => {
                if (
                  ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                    event.key,
                  )
                ) {
                  event.preventDefault();
                  change(
                    event.key === "ArrowLeft"
                      ? -0.01
                      : event.key === "ArrowRight"
                        ? 0.01
                        : 0,
                    event.key === "ArrowUp"
                      ? -0.01
                      : event.key === "ArrowDown"
                        ? 0.01
                        : 0,
                    handle,
                    crop,
                  );
                }
              }}
            >
              <span className="w-3 h-3 rounded-sm bg-white border-2 border-[#82DB7E]" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
