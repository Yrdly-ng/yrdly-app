"use client";

import React from "react";
import { cn } from "@/lib/utils";

export interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
  className?: string;
  contentClassName?: string;
  intensity?: number;
  borderRadius?: string | number;
}

export function GlassCard({
  children,
  className,
  contentClassName,
  intensity = 55,
  borderRadius = 20,
  style,
  ...props
}: GlassCardProps) {
  // Mobile intensity={55} translates to ~16px backdrop-blur on web for an equivalent frosted glass look
  const blurPx = Math.round((intensity / 55) * 16);

  const effectiveRadius = typeof borderRadius === "number" ? `${borderRadius}px` : borderRadius;

  // Extract flex alignment classes if present in className to also apply to inner container
  const flexAlignment = className
    ? className.split(/\s+/).filter(c => c.includes("flex") || c.includes("items-") || c.includes("justify-") || c === "text-center" || c === "text-left" || c === "text-right").join(" ")
    : "";

  return (
    <div
      className={cn(
        "relative overflow-hidden border transition-all duration-200",
        "bg-[var(--yrdly-glass-bg)] border-[var(--yrdly-glass-border)]",
        className
      )}
      style={{
        backdropFilter: `blur(${blurPx}px)`,
        WebkitBackdropFilter: `blur(${blurPx}px)`,
        borderRadius: effectiveRadius,
        ...style,
      }}
      {...props}
    >
      <div className={cn("relative z-10 w-full h-full", flexAlignment, contentClassName)}>
        {children}
      </div>
    </div>
  );
}
