"use client";

import { useEffect, useRef } from "react";

/**
 * Renders 3 soft, blurred mesh-gradient blobs that drift slowly and
 * parallax-shift in reverse of the cursor's position, giving dark
 * backgrounds a "deep water / space" ambience.
 */
export function AmbientBackground() {
  const blobRefs = useRef<(HTMLDivElement | null)[]>([]);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        const nx = e.clientX / window.innerWidth - 0.5;
        const ny = e.clientY / window.innerHeight - 0.5;
        blobRefs.current.forEach((blob, i) => {
          if (!blob) return;
          const depth = (i + 1) * 14;
          blob.style.transform = `translate3d(${-nx * depth}px, ${-ny * depth}px, 0)`;
        });
      });
    };
    window.addEventListener("mousemove", handleMove);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, []);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div
        ref={(el) => { blobRefs.current[0] = el; }}
        className="ambient-blob absolute top-[-10%] left-[-8%] h-[420px] w-[420px] rounded-full transition-transform duration-700 ease-out"
        style={{ background: "#22D3EE", filter: "blur(100px)", opacity: 0.15 }}
      />
      <div
        ref={(el) => { blobRefs.current[1] = el; }}
        className="ambient-blob absolute top-[30%] right-[-10%] h-[380px] w-[380px] rounded-full transition-transform duration-700 ease-out"
        style={{ background: "#34D399", filter: "blur(100px)", opacity: 0.15 }}
      />
      <div
        ref={(el) => { blobRefs.current[2] = el; }}
        className="ambient-blob absolute bottom-[-12%] left-[20%] h-[460px] w-[460px] rounded-full transition-transform duration-700 ease-out"
        style={{ background: "#A855F7", filter: "blur(100px)", opacity: 0.15 }}
      />
    </div>
  );
}