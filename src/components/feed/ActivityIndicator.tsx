"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase/supabase";
import { timeAgo, cn } from "@/lib/shared/utils";
import Image from "next/image";
import { getUserActivityStatus } from "@/lib/activity/online-status";

interface ActivityIndicatorProps {
  userId: string;
  showText?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}
export function ActivityIndicator({
  userId,
  showText = false,
  size = "md",
  className,
}: ActivityIndicatorProps) {
  const [status, setStatus] = useState({
    is_online: false,
    last_seen: null as string | null,
  });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let current = true;
    let request = 0;
    setStatus({ is_online: false, last_seen: null });
    const refresh = async () => {
      if (!userId || document.hidden) return;
      const revision = ++request;
      try {
        const { data, error } = await supabase
          .from("public_profiles")
          .select("is_online,last_seen")
          .eq("id", userId)
          .maybeSingle();
        if (current && revision === request) {
          setNow(Date.now());
          setStatus(
            !error && data
              ? { is_online: !!data.is_online, last_seen: data.last_seen }
              : { is_online: false, last_seen: null },
          );
        }
      } catch {
        if (current && revision === request)
          setStatus({ is_online: false, last_seen: null });
      }
    };
    void refresh();
    const channel = supabase
      .channel(`user-status-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "users",
          filter: `id=eq.${userId}`,
        },
        () => void refresh(),
      )
      .subscribe();
    const poll = setInterval(() => void refresh(), 30000);
    const tick = setInterval(() => {
      if (!document.hidden) setNow(Date.now());
    }, 15000);
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      current = false;
      clearInterval(poll);
      clearInterval(tick);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
      void supabase.removeChannel(channel);
    };
  }, [userId]);
  const activity = getUserActivityStatus(
    status.is_online,
    status.last_seen,
    now,
  );
  const sizes = { sm: "w-2 h-2", md: "w-3 h-3", lg: "w-4 h-4" };
  const textSizes = { sm: "text-xs", md: "text-sm", lg: "text-base" };
  const text =
    activity === "active"
      ? "Active now"
      : activity === "away"
        ? "Away"
        : status.last_seen && Number.isFinite(Date.parse(status.last_seen))
          ? `Last seen ${timeAgo(new Date(status.last_seen))}`
          : "Offline";
  if (activity === "offline" && !showText) return null;
  return (
    <div className={cn("flex items-center gap-2", className)}>
      {activity !== "offline" && (
        <span
          role="img"
          aria-label={activity === "active" ? "Active" : "Away"}
          className={cn(
            "rounded-full border-2 border-border dark:border-gray-800",
            sizes[size],
            activity === "active" ? "bg-green-500" : "bg-yellow-500",
          )}
        />
      )}
      {showText && (
        <span className={cn("text-muted-foreground", textSizes[size])}>
          {text}
        </span>
      )}
    </div>
  );
}

// Helper component for avatar with activity indicator
interface AvatarWithActivityProps {
  userId: string;
  avatarUrl?: string;
  name: string;
  size?: "sm" | "md" | "lg";
  showText?: boolean;
  className?: string;
}

export function AvatarWithActivity({
  userId,
  avatarUrl,
  name,
  size = "md",
  showText = false,
  className,
}: AvatarWithActivityProps) {
  const avatarSizeClasses = {
    sm: "w-8 h-8",
    md: "w-10 h-10",
    lg: "w-12 h-12",
  };

  const indicatorSizeClasses = {
    sm: "w-2 h-2 -bottom-0.5 -right-0.5",
    md: "w-3 h-3 -bottom-1 -right-1",
    lg: "w-4 h-4 -bottom-1 -right-1",
  };

  return (
    <div className={cn("relative", className)}>
      <div
        className={cn("rounded-full overflow-hidden", avatarSizeClasses[size])}
      >
        <Image
          src={avatarUrl || "/placeholder.svg"}
          alt={name}
          width={64}
          height={64}
          className="w-full h-full object-cover"
        />
      </div>

      <ActivityIndicator
        userId={userId}
        size={size === "lg" ? "md" : "sm"}
        className={cn("absolute", indicatorSizeClasses[size])}
      />

      {showText && (
        <div className="mt-1">
          <ActivityIndicator userId={userId} showText={true} size="sm" />
        </div>
      )}
    </div>
  );
}
