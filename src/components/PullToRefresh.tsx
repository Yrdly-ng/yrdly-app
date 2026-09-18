"use client";

import React, { useState, useEffect, useRef } from "react";
import { ArrowDown, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

interface PullToRefreshProps {
  children: React.ReactNode;
}

const PULL_THRESHOLD = 65;

export function PullToRefresh({ children }: PullToRefreshProps) {
  const router = useRouter();
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const startYRef = useRef(0);
  const isPullingRef = useRef(false);

  useEffect(() => {
    const handleTouchStart = (e: TouchEvent) => {
      if (window.scrollY === 0) {
        startYRef.current = e.touches[0].clientY;
        isPullingRef.current = true;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isPullingRef.current || isRefreshing) return;
      if (window.scrollY > 0) {
        isPullingRef.current = false;
        setPullDistance(0);
        return;
      }

      const currentY = e.touches[0].clientY;
      const diffY = currentY - startYRef.current;

      if (diffY > 0) {
        const dist = Math.min(diffY * 0.4, 90);
        setPullDistance(dist);
      } else {
        setPullDistance(0);
      }
    };

    const handleTouchEnd = async () => {
      if (!isPullingRef.current || isRefreshing) return;
      isPullingRef.current = false;

      if (pullDistance >= PULL_THRESHOLD) {
        setIsRefreshing(true);
        setPullDistance(60);

        try {
          router.refresh();
          await new Promise((resolve) => setTimeout(resolve, 800));
        } catch (e) {
          console.error("Refresh error:", e);
        } finally {
          setIsRefreshing(false);
          setPullDistance(0);
        }
      } else {
        setPullDistance(0);
      }
    };

    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchend", handleTouchEnd);

    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
    };
  }, [pullDistance, isRefreshing, router]);

  return (
    <div className="relative min-h-full">
      {/* Pull Indicator Pill */}
      <div
        className="fixed top-2 left-1/2 -translate-x-1/2 z-[100] pointer-events-none transition-transform duration-150 ease-out"
        style={{
          transform: `translate(-50%, ${pullDistance > 0 || isRefreshing ? pullDistance : -60}px)`,
          opacity: pullDistance > 10 || isRefreshing ? 1 : 0,
        }}
      >
        <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--c-card)]/95 border border-[#82DB7E]/40 text-[#82DB7E] shadow-xl backdrop-blur-md">
          {isRefreshing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin text-[#82DB7E]" />
              <span className="text-xs font-bold font-yrdly-body text-foreground">Refreshing…</span>
            </>
          ) : (
            <>
              <ArrowDown
                className={`w-4 h-4 text-[#82DB7E] transition-transform duration-200 ${
                  pullDistance >= PULL_THRESHOLD ? "rotate-180" : "rotate-0"
                }`}
              />
              <span className="text-xs font-bold font-yrdly-body text-foreground">
                {pullDistance >= PULL_THRESHOLD ? "Release to refresh" : "Pull down to refresh"}
              </span>
            </>
          )}
        </div>
      </div>

      {children}
    </div>
  );
}
