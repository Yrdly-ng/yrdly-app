"use client";

import { cn } from "@/lib/utils"

type SkeletonVariant = "line" | "circle" | "card" | "rect";

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** line = text bar, circle = avatar, card = content card, rect = raw box (default) */
  variant?: SkeletonVariant;
  /** disable the shimmer sweep and keep a simple pulse */
  shimmer?: boolean;
}

const VARIANT_CLASSES: Record<SkeletonVariant, string> = {
  line: "h-3 w-full rounded-full",
  circle: "w-10 h-10 rounded-full",
  card: "w-full rounded-[1.5rem]",
  rect: "rounded-md",
};

function Skeleton({
  className,
  variant = "rect",
  shimmer = true,
  style,
  ...props
}: SkeletonProps) {
  return (
    <div
      className={cn(
        "yrdly-skeleton relative overflow-hidden rounded-md bg-muted",
        VARIANT_CLASSES[variant],
        className
      )}
      style={style}
      {...props}
    >
      {shimmer && (
        <span
          aria-hidden
          className="yrdly-skeleton-shimmer pointer-events-none absolute inset-0"
        />
      )}
    </div>
  )
}

export { Skeleton }
