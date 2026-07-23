"use client";

import { useRef, useCallback, type ReactNode, type CSSProperties } from "react";

interface MagneticProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  /** How strongly the element pulls toward the cursor, in px. */
  strength?: number;
  disabled?: boolean;
  type?: "button" | "submit";
  "aria-label"?: string;
}

/**
 * Wraps a button so it "magnetically" translates a few px toward the
 * cursor while hovered, with a springy scale pop on hover/active.
 */
export function Magnetic({
  children,
  className = "",
  style,
  onClick,
  strength = 10,
  disabled,
  type = "button",
  ...rest
}: MagneticProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const frame = useRef<number | null>(null);

  const handleMove = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      const el = ref.current;
      if (!el) return;
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        const rect = el.getBoundingClientRect();
        const x = e.clientX - (rect.left + rect.width / 2);
        const y = e.clientY - (rect.top + rect.height / 2);
        const clampedX = Math.max(-strength, Math.min(strength, x * 0.35));
        const clampedY = Math.max(-strength, Math.min(strength, y * 0.35));
        el.style.transform = `translate(${clampedX}px, ${clampedY}px) scale(1.05)`;
      });
    },
    [strength]
  );

  const handleLeave = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (frame.current) cancelAnimationFrame(frame.current);
    el.style.transform = "translate(0px, 0px) scale(1)";
  }, []);

  const handleDown = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.transform = el.style.transform.replace(/scale\([^)]*\)/, "scale(0.95)");
  }, []);

  const handleUp = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.transform = el.style.transform.replace(/scale\([^)]*\)/, "scale(1.05)");
  }, []);

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      onClick={onClick}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      onMouseDown={handleDown}
      onMouseUp={handleUp}
      className={`magnetic-btn inline-flex will-change-transform transition-transform duration-150 ease-out ${className}`}
      style={style}
      {...rest}
    >
      {children}
    </button>
  );
}