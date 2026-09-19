"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Calendar,
  MapPin,
  Share2,
  Heart,
  ArrowRight,
  Sparkles,
  Zap,
  Gift,
  TrendingUp,
  Clock,
  PlayCircle,
  Edit,
} from "lucide-react";
import type { Post } from "@/types";
import { formatPrice } from "@/lib/utils";
import { useAuth } from "@/hooks/use-supabase-auth";
import { supabase } from "@/lib/supabase";
import { GlassCard } from "@/components/GlassCard";
import { AttendeeAvatars } from "@/components/AttendeeAvatars";
import { VerifiedBadge } from "@/components/VerifiedBadge";

interface EventCardProps {
  event: Post;
  onPress?: () => void;
  compact?: boolean;
}

type BadgeType = "Today" | "Tomorrow" | "This Weekend" | "Free" | "Trending" | "New";

function getEventBadge(event: Post): BadgeType | null {
  if (!event.event_date) return null;
  const d = new Date(event.event_date);
  const now = new Date();
  const diffDays = Math.floor((d.getTime() - now.getTime()) / 86400000);
  if (event.price === 0 || !event.price) return "Free";
  const ageHours =
    (now.getTime() - new Date(event.timestamp || event.created_at || "").getTime()) / 3600000;
  if (ageHours < 12) return "New";
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays >= 2 && diffDays <= 5) return "This Weekend";
  if ((event as any).view_count > 80) return "Trending";
  return null;
}

const BADGE_STYLE: Record<BadgeType, { bg: string; color: string }> = {
  Today: { bg: "rgba(239,68,68,0.2)", color: "#ef4444" },
  Tomorrow: { bg: "rgba(245,158,11,0.2)", color: "#F59E0B" },
  "This Weekend": { bg: "rgba(139,92,246,0.2)", color: "#8B5CF6" },
  Free: { bg: "rgba(34,197,94,0.2)", color: "#22c55e" },
  Trending: { bg: "rgba(245,158,11,0.2)", color: "#F59E0B" },
  New: { bg: "rgba(130,219,126,0.2)", color: "#82DB7E" },
};

function getLocation(loc: any): string {
  if (!loc) return "";
  if (typeof loc === "string") return loc;
  if (loc.address) return loc.address;
  return "";
}

function fmtDate(dateStr: string): { day: string; month: string; full: string; time: string } {
  const d = new Date(dateStr);
  return {
    day: d.toLocaleDateString("en-GB", { day: "2-digit" }),
    month: d.toLocaleDateString("en-GB", { month: "short" }).toUpperCase(),
    full: d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }),
    time: d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
  };
}

export function EventCardCompact({ event, onPress }: EventCardProps) {
  const { user } = useAuth();
  const router = useRouter();
  const isOwner = user?.id === event.user_id;
  const [saved, setSaved] = useState(false);
  const imageUrl = event.image_urls?.[0] || event.image_url;
  const badge = getEventBadge(event);
  const dateInfo = event.event_date ? fmtDate(event.event_date) : null;
  const location = getLocation(event.event_location);

  useEffect(() => {
    if (user && event.id) {
      supabase
        .from("event_bookmarks")
        .select("id")
        .eq("event_id", event.id)
        .eq("user_id", user.id)
        .maybeSingle()
        .then(({ data }) => setSaved(!!data));
    }
  }, [user, event.id]);

  const toggleSave = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) return;
    const newSaved = !saved;
    setSaved(newSaved);
    if (newSaved) {
      const { error } = await supabase
        .from("event_bookmarks")
        .insert({ event_id: event.id, user_id: user.id });
      if (error) setSaved(false);
    } else {
      const { error } = await supabase
        .from("event_bookmarks")
        .delete()
        .match({ event_id: event.id, user_id: user.id });
      if (error) setSaved(true);
    }
  };

  const handleCardClick = () => {
    if (onPress) {
      onPress();
    } else {
      router.push(`/events/${event.id}`);
    }
  };

  return (
    <GlassCard
      onClick={handleCardClick}
      className="group cursor-pointer overflow-hidden rounded-2xl transition-all duration-200 hover:-translate-y-1 hover:shadow-xl w-[260px] flex-shrink-0"
    >
      {/* Cover Image Header */}
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-muted">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={event.title || "Event"}
            fill
            className="object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-emerald-950/40">
            <Calendar className="h-8 w-8 text-primary/40" />
          </div>
        )}

        {/* Date Bubble */}
        {dateInfo && (
          <div className="absolute left-3 top-3 flex flex-col items-center justify-center rounded-xl bg-background/80 backdrop-blur-md px-2.5 py-1 text-center shadow-lg border border-border/50">
            <span className="text-[0.625rem] font-bold uppercase tracking-wider text-primary">
              {dateInfo.month}
            </span>
            <span className="text-sm font-extrabold text-foreground">{dateInfo.day}</span>
          </div>
        )}

        {/* Heart Bookmark */}
        <button
          onClick={toggleSave}
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-background/70 backdrop-blur-md transition-all hover:bg-background/90 active:scale-95"
        >
          <Heart className={`h-4 w-4 ${saved ? "fill-red-500 text-red-500" : "text-foreground"}`} />
        </button>

        {/* Badge */}
        {badge && (
          <div
            className="absolute bottom-2 left-3 rounded-full px-2.5 py-0.5 text-[0.625rem] font-bold backdrop-blur-md"
            style={{ backgroundColor: BADGE_STYLE[badge].bg, color: BADGE_STYLE[badge].color }}
          >
            {badge}
          </div>
        )}
      </div>

      {/* Info Body */}
      <div className="p-3.5 space-y-2">
        <h4 className="line-clamp-1 text-sm font-bold text-foreground group-hover:text-primary transition-colors">
          {event.title || event.text || "Event"}
        </h4>

        {dateInfo && (
          <div className="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
            <Calendar className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{dateInfo.full} at {dateInfo.time}</span>
          </div>
        )}

        {!!location && (
          <div className="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
            <MapPin className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{location}</span>
          </div>
        )}

        <div className="pt-1 flex items-center justify-between">
          <span className="text-xs font-bold text-primary">
            {event.price === 0 || !event.price ? "Free Entry" : formatPrice(event.price)}
          </span>
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform group-hover:scale-110">
            {isOwner ? <Edit className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5" />}
          </div>
        </div>
      </div>
    </GlassCard>
  );
}

export function EventCard({ event, onPress }: EventCardProps) {
  const { user } = useAuth();
  const router = useRouter();
  const isOwner = user?.id === event.user_id;
  const [saved, setSaved] = useState(false);
  const imageUrl = event.image_urls?.[0] || event.image_url;
  const badge = getEventBadge(event);
  const dateInfo = event.event_date ? fmtDate(event.event_date) : null;
  const location = getLocation(event.event_location);

  useEffect(() => {
    if (user && event.id) {
      supabase
        .from("event_bookmarks")
        .select("id")
        .eq("event_id", event.id)
        .eq("user_id", user.id)
        .maybeSingle()
        .then(({ data }) => setSaved(!!data));
    }
  }, [user, event.id]);

  const toggleSave = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) return;
    const newSaved = !saved;
    setSaved(newSaved);
    if (newSaved) {
      const { error } = await supabase
        .from("event_bookmarks")
        .insert({ event_id: event.id, user_id: user.id });
      if (error) setSaved(false);
    } else {
      const { error } = await supabase
        .from("event_bookmarks")
        .delete()
        .match({ event_id: event.id, user_id: user.id });
      if (error) setSaved(true);
    }
  };

  const handleCardClick = () => {
    if (onPress) {
      onPress();
    } else {
      router.push(`/events/${event.id}`);
    }
  };

  return (
    <GlassCard
      onClick={handleCardClick}
      className="group cursor-pointer overflow-hidden rounded-2xl transition-all duration-200 hover:-translate-y-1 hover:shadow-2xl w-full"
    >
      {/* Cover Image */}
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-muted">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={event.title || "Event"}
            fill
            className="object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-emerald-950/40">
            <Calendar className="h-12 w-12 text-primary/40" />
          </div>
        )}

        {/* Date Bubble */}
        {dateInfo && (
          <div className="absolute left-4 top-4 flex flex-col items-center justify-center rounded-2xl bg-background/80 backdrop-blur-md px-3 py-1.5 text-center shadow-lg border border-border/50">
            <span className="text-[0.6875rem] font-bold uppercase tracking-wider text-primary">
              {dateInfo.month}
            </span>
            <span className="text-base font-extrabold text-foreground">{dateInfo.day}</span>
          </div>
        )}

        {/* Heart Bookmark Button */}
        <button
          onClick={toggleSave}
          className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-background/70 backdrop-blur-md transition-all hover:bg-background/90 active:scale-95 shadow-sm"
        >
          <Heart className={`h-4.5 w-4.5 ${saved ? "fill-red-500 text-red-500" : "text-foreground"}`} />
        </button>

        {/* Badge Tag */}
        {badge && (
          <div
            className="absolute bottom-3 left-4 rounded-full px-3 py-1 text-xs font-bold backdrop-blur-md shadow-sm"
            style={{ backgroundColor: BADGE_STYLE[badge].bg, color: BADGE_STYLE[badge].color }}
          >
            {badge}
          </div>
        )}
      </div>

      {/* Info Content */}
      <div className="p-4 space-y-3">
        <h3 className="line-clamp-1 text-base font-bold text-foreground group-hover:text-primary transition-colors">
          {event.title || event.text || "Event"}
        </h3>

        {event.text && event.title && (
          <p className="line-clamp-2 text-xs text-muted-foreground">{event.text}</p>
        )}

        <div className="flex flex-col gap-1.5 text-xs text-muted-foreground pt-1">
          {dateInfo && (
            <div className="flex items-center gap-2">
              <Calendar className="h-3.5 w-3.5 text-primary flex-shrink-0" />
              <span>{dateInfo.full} at {dateInfo.time}</span>
            </div>
          )}

          {!!location && (
            <div className="flex items-center gap-2">
              <MapPin className="h-3.5 w-3.5 text-primary flex-shrink-0" />
              <span className="truncate">{location}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="pt-2 flex items-center justify-between border-t border-border/50">
          <div>
            <span className="text-xs text-muted-foreground block">Price</span>
            <span className="text-sm font-extrabold text-primary">
              {event.price === 0 || !event.price ? "Free Entry" : formatPrice(event.price)}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* Organizer Avatar */}
            <div className="flex items-center gap-2">
              <div className="relative h-7 w-7 rounded-full overflow-hidden bg-primary/20 border border-primary/30 flex items-center justify-center">
                {event.author_image ? (
                  <Image src={event.author_image} alt={event.author_name || "Host"} fill className="object-cover" />
                ) : (
                  <span className="text-xs font-bold text-primary">
                    {(event.author_name || "E").charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
            </div>

            {/* CTA Button */}
            <button
              onClick={handleCardClick}
              className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition-all ${
                isOwner
                  ? "border border-primary text-primary hover:bg-primary/10"
                  : "bg-primary text-primary-foreground hover:brightness-110 shadow-sm"
              }`}
            >
              <span>{isOwner ? "Edit" : "RSVP"}</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </GlassCard>
  );
}
