"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Bookmark, CalendarDays, MapPin } from "lucide-react";
import type { Post } from "@/types/index";
import { formatPrice } from "@/lib/shared/utils";
import { useAuth } from "@/hooks/use-supabase-auth";
import { supabase } from "@/lib/supabase/supabase";
import {
  getEventDateInfo,
  getEventPriceLabel,
} from "@/lib/events/event-presentation";

interface EventCardProps {
  event: Post;
  onPress?: () => void;
  compact?: boolean;
}

export function EventCard({ event, onPress, compact = false }: EventCardProps) {
  const router = useRouter();
  const { user } = useAuth();
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const image = event.image_urls?.[0] || event.image_url;
  const date = getEventDateInfo(event.event_date);
  const location =
    typeof event.event_location === "string"
      ? event.event_location
      : event.event_location?.address;
  const price = getEventPriceLabel(event, formatPrice);
  useEffect(() => {
    let current = true;
    setSaved(false);
    if (user && event.id) {
      void supabase
        .from("event_bookmarks")
        .select("id")
        .eq("event_id", event.id)
        .eq("user_id", user.id)
        .maybeSingle()
        .then(({ data }) => {
          if (current) setSaved(!!data);
        });
    }
    return () => {
      current = false;
    };
  }, [user?.id, event.id]);
  const save = async () => {
    if (!user) {
      router.push("/login");
      return;
    }
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const { error } = saved
        ? await supabase
            .from("event_bookmarks")
            .delete()
            .match({ event_id: event.id, user_id: user.id })
        : await supabase
            .from("event_bookmarks")
            .insert({ event_id: event.id, user_id: user.id });
      if (!error) setSaved(!saved);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  return (
    <article className="group relative min-w-0 overflow-hidden rounded-[26px] border border-border bg-card transition-shadow hover:shadow-lg">
      <button
        type="button"
        onClick={() =>
          onPress ? onPress() : router.push(`/events/${event.id}`)
        }
        className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
        aria-label={`View ${event.title || "event"}`}
      >
        <div
          className={`relative overflow-hidden bg-muted ${compact ? "aspect-[16/10]" : "aspect-[4/3]"}`}
        >
          {image ? (
            <Image
              src={image}
              alt=""
              fill
              sizes="(max-width: 640px) 100vw, (max-width: 1200px) 50vw, 33vw"
              className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <CalendarDays className="h-14 w-14 text-primary/50" />
            </div>
          )}
          {date && (
            <div className="absolute left-4 top-4 rounded-2xl bg-background/95 px-3 py-2 text-center shadow-sm">
              <span className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {date.month}
              </span>
              <span className="block font-yrdly-display text-2xl font-bold">
                {date.day}
              </span>
            </div>
          )}
        </div>
        <div className="space-y-3 p-5">
          <div className="flex items-start justify-between gap-3">
            <h3 className="line-clamp-2 font-yrdly-display text-xl font-bold leading-tight">
              {event.title || event.text || "Event"}
            </h3>
            <ArrowUpRight className="h-5 w-5 shrink-0 text-primary" />
          </div>
          {date ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CalendarDays className="h-4 w-4 shrink-0" />
              {date.full} · {date.time}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Date to be announced
            </p>
          )}
          {location && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4 shrink-0" />
              <span className="truncate">{location}</span>
            </p>
          )}
          <div className="border-t border-border pt-3 text-sm font-semibold text-primary">
            {price}
          </div>
        </div>
      </button>
      <button
        type="button"
        onClick={() => void save()}
        disabled={saving}
        aria-label={saved ? "Unsave event" : "Save event"}
        aria-pressed={saved}
        className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full border border-border bg-background/95 text-foreground shadow-sm focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
      >
          <Bookmark
          className={`h-5 w-5 ${saved ? "fill-primary text-primary" : ""}`}
        />
      </button>
    </article>
  );
}

export function EventCardCompact(props: EventCardProps) {
  return <EventCard {...props} compact />;
}
