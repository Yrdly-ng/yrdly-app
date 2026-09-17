"use client";

import React from 'react';
import { cn } from '@/lib/utils';

interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  gradientBorder?: boolean;
}

export function GlassCard({
  children,
  className,
  gradientBorder = false,
  ...props
}: GlassCardProps) {
  return (
    <div
      className={cn(
        "relative rounded-xl border bg-background/60 backdrop-blur-md shadow-sm transition-all hover:shadow-md",
        gradientBorder && "border-transparent bg-gradient-to-r from-primary/20 via-border to-primary/10 p-[1px]",
        className
      )}
      {...props}
    >
      <div className={cn("rounded-[11px] h-full w-full bg-background/80 p-4", gradientBorder && "backdrop-blur-md")}>
        {children}
      </div>
    </div>
  );
}
