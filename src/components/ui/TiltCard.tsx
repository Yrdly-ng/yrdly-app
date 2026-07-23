"use client";

import { useRef, useCallback, type ReactNode, type CSSProperties } from "react";

interface TiltCardProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
  /** Max rotation in degrees. Keep small for a subtle "floating glass" feel. */
  maxTilt?: number;
  /** Slight scale-up on hover to reinforce the lift. */
  scale?: number;
  glare?: boolean;
}

/**
 * Wraps children in a container that tilts in 3D space toward the cursor
 * on hover (perspective + rotateX/rotateY), like a pane of floating glass.
 */
export function TiltCard({
  children,
  className = "",
  style,
  onClick,
  maxTilt = 5,
  scale = 1.015,
  glare = true,
}: TiltCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const frame = useRef<number | null>(null);

  const handleMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = ref.current;
      if (!el) return;
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        const rect = el.getBoundingClientRect();
        const px = (e.clientX - rect.left) / rect.width;
        const py = (e.clientY - rect.top) / rect.height;
        const rotateY = (px - 0.5) * 2 * maxTilt;
        const rotateX = (0.5 - py) * 2 * maxTilt;
        el.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(${scale}, ${scale}, ${scale})`;
        el.style.setProperty("--glare-x", `${px * 100}%`);
        el.style.setProperty("--glare-y", `${py * 100}%`);
      });
    },
    [maxTilt, scale]
  );

  const handleLeave = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (frame.current) cancelAnimationFrame(frame.current);
    el.style.transform = "perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)";
  }, []);

  return (
    <div
      ref={ref}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      onClick={onClick}
      className={`tilt-card relative will-change-transform transition-transform duration-300 ease-out ${className}`}
      style={{ transformStyle: "preserve-3d", ...style }}
    >
      {children}
      {glare && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-0 hover:opacity-100 transition-opacity duration-300"
          style={{
            borderRadius: "inherit",
            background:
              "radial-gradient(280px circle at var(--glare-x, 50%) var(--glare-y, 50%), rgba(255,255,255,0.16), transparent 55%)",
            mixBlendMode: "overlay",
          }}
        />
      )}
    </div>
  );
}