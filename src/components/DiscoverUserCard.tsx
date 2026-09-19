"use client";

import React from "react";
import Image from "next/image";
import { MapPin, Users, ShoppingBag, UserPlus, UserCheck, Loader2 } from "lucide-react";
import { GlassCard } from "@/components/GlassCard";
import { useFollowStatus } from "@/hooks/use-follow-status";

interface DiscoverUserCardProps {
  user: {
    id: string;
    name: string;
    avatar_url?: string;
    location?: {
      lga?: string;
      state?: string;
    };
    home_state?: string | null;
    home_lga?: string | null;
  };
  context: "neighbor" | "mutual" | "seller";
  mutualCount?: number;
  onPress: () => void;
}

export function DiscoverUserCard({
  user,
  context,
  mutualCount,
  onPress,
}: DiscoverUserCardProps) {
  const userId = user?.id || "";
  const { isFollowing, loading: actionLoading, toggleFollow } = useFollowStatus(userId);

  let badgeIcon = MapPin;
  let badgeText = "";

  if (context === "neighbor") {
    badgeIcon = MapPin;
    if (user?.home_lga && user?.home_state) {
      badgeText = `${user.home_lga}, ${user.home_state}`;
    } else if (user?.home_state) {
      badgeText = `${user.home_state} State`;
    } else if (user?.location?.lga && user?.location?.state) {
      badgeText = `${user.location.lga}, ${user.location.state}`;
    } else if (user?.location?.state) {
      badgeText = `${user.location.state} State`;
    } else {
      badgeText = "Nearby";
    }
  } else if (context === "mutual") {
    badgeIcon = Users;
    badgeText = `${mutualCount || 1} mutual friend${(mutualCount || 1) !== 1 ? "s" : ""}`;
  } else if (context === "seller") {
    badgeIcon = ShoppingBag;
    badgeText = "Active Seller";
  }

  const BadgeIconComponent = badgeIcon;

  const handleFollowClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFollow();
  };

  return (
    <GlassCard
      onClick={onPress}
      className="group cursor-pointer p-4 rounded-2xl flex flex-col items-center text-center space-y-3 transition-all duration-200 hover:-translate-y-1 hover:shadow-xl w-[200px] flex-shrink-0"
    >
      {/* User Avatar */}
      <div className="relative h-20 w-20 rounded-full overflow-hidden bg-primary/20 border-2 border-primary/30 flex items-center justify-center shadow-md">
        {user?.avatar_url ? (
          <Image src={user.avatar_url} alt={user.name || "User"} fill className="object-cover" />
        ) : (
          <span className="text-xl font-black text-primary">
            {(user?.name || "A").charAt(0).toUpperCase()}
          </span>
        )}
      </div>

      {/* Info Header */}
      <div className="space-y-1 w-full">
        <h4 className="line-clamp-1 text-sm font-bold text-foreground group-hover:text-primary transition-colors">
          {user?.name || "Anonymous"}
        </h4>

        <div className="flex items-center justify-center gap-1 text-[0.6875rem] text-muted-foreground w-full">
          <BadgeIconComponent className="h-3 w-3 flex-shrink-0 text-primary" />
          <span className="truncate">{badgeText}</span>
        </div>
      </div>

      {/* Follow Action Button */}
      <button
        onClick={handleFollowClick}
        disabled={actionLoading}
        className={`w-full flex items-center justify-center gap-1.5 rounded-full py-1.5 px-3 text-xs font-semibold transition-all active:scale-95 ${
          isFollowing
            ? "border border-border text-muted-foreground hover:bg-muted/50"
            : "bg-primary/15 text-primary hover:bg-primary/25 border border-primary/30"
        }`}
      >
        {actionLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : isFollowing ? (
          <>
            <UserCheck className="h-3.5 w-3.5" />
            <span>Following</span>
          </>
        ) : (
          <>
            <UserPlus className="h-3.5 w-3.5" />
            <span>Follow</span>
          </>
        )}
      </button>
    </GlassCard>
  );
}
