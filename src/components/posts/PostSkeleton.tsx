'use client';

import React from 'react';
import { Skeleton } from '@/components/ui/skeleton';

export function PostSkeleton() {
  return (
    <div className="p-4 sm:p-5 rounded-xl border border-border/40 bg-card space-y-4 shadow-2xs">
      {/* Header */}
      <div className="flex items-center space-x-3">
        <Skeleton className="h-10 w-10 rounded-full shrink-0" />
        <div className="space-y-1.5 flex-1">
          <Skeleton className="h-4 w-32 rounded-md" />
          <Skeleton className="h-3 w-20 rounded-md" />
        </div>
      </div>

      {/* Body text */}
      <div className="space-y-2">
        <Skeleton className="h-3.5 w-full rounded-md" />
        <Skeleton className="h-3.5 w-4/5 rounded-md" />
      </div>

      {/* Media placeholder */}
      <Skeleton className="h-48 sm:h-56 w-full rounded-lg" />

      {/* Footer actions */}
      <div className="flex items-center justify-between pt-1">
        <Skeleton className="h-8 w-16 rounded-full" />
        <Skeleton className="h-8 w-16 rounded-full" />
        <Skeleton className="h-8 w-16 rounded-full" />
      </div>
    </div>
  );
}
