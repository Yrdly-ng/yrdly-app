"use client";

import { useCallback, type ReactNode, type CSSProperties } from "react";

interface SpotlightProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** rgba color string for the glow, e.g. "rgba(59,130,246,0.12)" */
  color?: string;
  /** Diameter of the glow circle in px. */
  size?: number;
  onClick?: () => void;
}

/**
 * Tracks the cursor over its surface and paints a soft radial glow that
 * follows the mouse — a "spotlight" effect for dark cards/containers.
 */
export function Spotlight({
  children,
  className = "",
  style,
  color = "rgba(59,130,246,0.12)",
  size = 600,
  onClick,
}: SpotlightProps) {
  const handleMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      const rect = el.getBoundingClientRect();
      el.style.setProperty("--mouse-x", `${e.clientX - rect.left}px`);
      el.style.setProperty("--mouse-y", `${e.clientY - rect.top}px`);
    },
    []
  );

  return (
    <div
      onMouseMove={handleMove}
      onClick={onClick}
      className={`spotlight-surface relative ${className}`}
      style={
        {
          "--spotlight-color": color,
          "--spotlight-size": `${size}px`,
          ...style,
        } as CSSProperties
      }
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 [.spotlight-surface:hover_&]:opacity-100 transition-opacity duration-300"
        style={{
          borderRadius: "inherit",
          background:
            "radial-gradient(var(--spotlight-size) circle at var(--mouse-x, 50%) var(--mouse-y, 50%), var(--spotlight-color), transparent 40%)",
        }}
      />
      {children}
    </div>
  );
}