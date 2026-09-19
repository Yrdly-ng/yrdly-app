"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  CalendarDays,
  MapPin,
  Share2,
  ChevronDown,
  Plus,
  Heart,
  ArrowUpRight,
  BadgeCheck,
} from "lucide-react";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useToast } from "@/hooks/use-toast";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { Event } from "@/types/events";
import { getPublishedEvents } from "@/lib/event-service";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Carousel, CarouselContent, CarouselItem, type CarouselApi } from "@/components/ui/carousel";
import { formatPrice, timeAgo } from "@/lib/utils";
import { sendEventConfirmationEmail } from "@/lib/email-actions";
import { cn } from "@/lib/utils";
import { useLocation } from "@/contexts/LocationContext";
import { LocationChip } from "@/components/LocationChip";
import { EventCreatorOnboarding } from "@/components/events/EventCreatorOnboarding";
import { AttendeeAvatars } from "@/components/AttendeeAvatars";
import { EventCard, EventCardCompact } from "@/components/EventCard";
import { TiltCard } from "@/components/ui/TiltCard";
import { Magnetic } from "@/components/ui/Magnetic";
import { RevealOnScroll } from "@/components/ui/RevealOnScroll";

import { GlassCard } from "@/components/ui/glass-card";

interface EventsScreenProps {
  className?: string;
}

function formatEventDate(d: string | null | undefined): string {
  if (!d) return "";
  try {
    const date = new Date(d);
    return date.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

function formatEventDateTime(d: string | null | undefined, t?: string | null): string {
  if (!d) return "";
  const time = t || "9am";
  try {
    const date = new Date(d);
    const day = date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
    return `${time}, ${day}`;
  } catch {
    return "";
  }
}

function categoryEmoji(category: string | null | undefined): string {
  const c = (category || "").toLowerCase();
  if (c.includes("anime")) return "🎨";
  if (c.includes("tech")) return "🧪";
  if (c.includes("music") || c.includes("concert")) return "🎵";
  if (c.includes("sport")) return "⚽";
  if (c.includes("food")) return "🍔";
  if (c.includes("art")) return "🎨";
  if (c.includes("business")) return "💼";
  if (c.includes("education")) return "📚";
  return "✨";
}

function dateChipParts(d: string | null | undefined): { day: string; month: string } {
  if (!d) return { day: "--", month: "" };
  try {
    const date = new Date(d);
    return {
      day: date.toLocaleDateString("en-GB", { day: "2-digit" }),
      month: date.toLocaleDateString("en-GB", { month: "short" }).toUpperCase(),
    };
  } catch {
    return { day: "--", month: "" };
  }
}

const QUICK_FILTERS = ["Today"] as const;
type QuickFilter = typeof QUICK_FILTERS[number];

function isToday(d: string | null | undefined): boolean {
  if (!d) return false;
  const date = new Date(d);
  const now = new Date();
  return date.toDateString() === now.toDateString();
}



export function EventsScreen({ className }: EventsScreenProps) {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const { activeFilter } = useLocation();
  const filterState = activeFilter?.state;
  const filterLga = activeFilter?.lga;
  const filterWard = activeFilter?.ward;
  const [events, setEvents] = useState<Event[]>([]);
  const [rsvpLoading, setRsvpLoading] = useState<Set<string>>(new Set());
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<"date" | "price" | "all" | "">("");
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [carouselApi, setCarouselApi] = useState<CarouselApi | null>(null);
  const [activeQuickFilters, setActiveQuickFilters] = useState<Set<QuickFilter>>(new Set());
  const [savedEvents, setSavedEvents] = useState<Set<string>>(new Set());

  const toggleQuickFilter = (filter: QuickFilter) => {
    setActiveQuickFilters((prev) => {
      const next = new Set(prev);
      if (next.has(filter)) next.delete(filter);
      else next.add(filter);
      return next;
    });
  };

  const toggleSaved = (eventId: string) => {
    setSavedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  };

  const handleCreateEvent = () => {
    if (!profile?.phone_verified) {
      router.push("/verify-phone");
      return;
    }
    setOnboardingOpen(true);
  };

  useEffect(() => {
    if (!carouselApi) return;
    const onSelect = () => setCarouselIndex(carouselApi.selectedScrollSnap());
    carouselApi.on("select", onSelect);
    return () => {
      carouselApi.off("select", onSelect);
    };
  }, [carouselApi]);

  const handleRSVP = async (eventId: string) => {
    router.push(`/events/${eventId}`);
  };

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const data = await getPublishedEvents({
          state: filterState || undefined,
          lga: filterLga || undefined,
          ward: filterWard || undefined,
        });
        setEvents(data);
      } catch (err) {
        console.error("Failed to fetch events", err);
      } finally {
        setLoading(false);
      }
    };
    fetchEvents();
  }, [filterState, filterLga, filterWard]);

  const filteredAndSorted = useMemo(() => {
    let list = [...events];
    if (activeQuickFilters.size > 0) {
      list = list.filter((event) => {
        return Array.from(activeQuickFilters).every((f) => {
          if (f === "Today") return isToday(event.start_time);
          if (f === "Free") return !event.ticket_tiers?.length || event.ticket_tiers.every(t => t.price === 0);
          return true;
        });
      });
    }
    if (sortBy === "price") {
      list.sort((a, b) => {
        const aMin = Math.min(...(a.ticket_tiers?.map(t => t.price) || [0]));
        const bMin = Math.min(...(b.ticket_tiers?.map(t => t.price) || [0]));
        return aMin - bMin;
      });
    } else if (sortBy === "date") {
      list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }
    return list;
  }, [events, sortBy, activeQuickFilters]);

  const pickedForYou = filteredAndSorted.slice(0, 5);
  const inYourArea = filteredAndSorted.slice(0, 3);
  const mainstream = filteredAndSorted;

  if (loading) {
    return (
      <div className={cn("p-4 space-y-6", className)}>
        <Skeleton className="h-[280px] sm:h-[330px] w-full rounded-[28px]" style={{ background: "var(--c-card)" }} />
        <Skeleton className="h-8 w-32" style={{ background: "var(--c-card)" }} />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[200px] rounded" style={{ background: "var(--c-card)" }} />
          ))}
        </div>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-8 w-20 flex-shrink-0 rounded-md" style={{ background: "var(--c-card)" }} />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-[400px] rounded-[11px]" style={{ background: "var(--c-card)" }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("min-h-[100dvh] bg-[var(--yrdly-dark)] text-foreground font-yrdly-body p-3 sm:p-4 md:p-6 space-y-6 md:space-y-8 pb-20 lg:pb-8", className)}>

      {/* Quick filter bar */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
        {QUICK_FILTERS.map((filter) => {
          const active = activeQuickFilters.has(filter);
          return (
            <button
              key={filter}
              onClick={() => toggleQuickFilter(filter)}
              className={cn(
                "flex-shrink-0 px-3.5 py-1.5 rounded-full font-yrdly-body text-xs font-semibold transition-all border",
                active
                  ? "bg-[var(--yrdly-glass-bg)] text-foreground border-[var(--yrdly-glass-border)] shadow-sm font-yrdly-display"
                  : "bg-transparent border-[var(--yrdly-glass-border)] text-[var(--yrdly-label)] hover:text-foreground"
              )}
            >
              {filter}
            </button>
          );
        })}
      </div>
      {/* Picked for You */}
      <section className="space-y-3 sm:space-y-4">
        <h2 className="text-lg sm:text-[1.125rem] leading-8 text-foreground font-yrdly-display font-bold">
          Picked for You
        </h2>
        {pickedForYou.length === 0 ? (
          <GlassCard className="rounded-[28px] h-[220px] sm:h-[280px] md:h-[330px] flex flex-col items-center justify-center gap-3 px-6 text-center">
            <CalendarDays className="w-12 h-12 text-[var(--yrdly-label)]" aria-hidden />
            <p className="text-foreground font-yrdly-display font-bold text-sm">No events picked for you yet</p>
            <p className="text-[var(--yrdly-label)] font-yrdly-body text-xs max-w-[240px]">Create an event or check back later for recommendations.</p>
          </GlassCard>
        ) : (
          <>
            <Carousel
              opts={{ align: "start", loop: true }}
              className="w-full"
              setApi={setCarouselApi}
            >
              <CarouselContent className="-ml-2 sm:-ml-4">
                {pickedForYou.map((event) => (
                  <CarouselItem
                    key={event.id}
                    className="pl-2 sm:pl-4 basis-[92%] sm:basis-[82%] md:basis-[72%] lg:basis-[68%]"
                  >
                    <TiltCard
                      className="w-full rounded-[20px] sm:rounded-[24px] overflow-hidden aspect-[820/340] max-h-[300px] sm:max-h-[350px] bg-card border border-[var(--yrdly-glass-border)]"
                      maxTilt={0}
                      scale={1}
                      glare={false}
                      onClick={() => router.push(`/events/${event.id}`)}
                    >
                      <Image
                        src={event.cover_image_url || "/placeholder.svg"}
                        alt={event.title || "Event"}
                        fill
                        className="object-cover"
                        sizes="(max-width: 768px) 100vw, 75vw"
                      />
                      {/* Category badge */}
                      <div className="absolute top-4 left-4 sm:top-5 sm:left-5 z-10">
                        <span
                          className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-yrdly-body font-semibold text-white"
                          style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(6px)" }}
                        >
                          {categoryEmoji(event.category)} {event.category || "Event"}
                        </span>
                      </div>
                      {/* Dark gradient overlay for text legibility */}
                      <div
                        className="absolute inset-0 rounded-[20px] sm:rounded-[24px]"
                        style={{
                          background: "linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(0,0,0,0.75) 100%)",
                        }}
                      />
                      <div className="absolute inset-0 flex flex-col justify-end p-4 sm:p-6 md:p-8">
                        <h3 className="font-yrdly-display font-extrabold text-lg sm:text-[1.4375rem] text-white mb-2 drop-shadow-sm">
                          {event.title || "Event"}
                        </h3>
                        <div className="flex flex-wrap items-center gap-3 text-white/90 text-xs sm:text-[0.8125rem] font-yrdly-body">
                          <span className="flex items-center gap-1">
                            <CalendarDays className="w-4 h-4" />
                            {formatEventDateTime(event.start_time)}
                          </span>
                          <span className="flex items-center gap-1 truncate">
                            <MapPin className="w-4 h-4 flex-shrink-0" />
                            {event.location_address || "Online"}
                          </span>
                        </div>
                        <Magnetic
                          className="absolute bottom-4 right-4 sm:bottom-6 sm:right-6 md:bottom-8 md:right-8 w-11 h-11 sm:w-12 sm:h-12 rounded-full flex items-center justify-center text-foreground transition-shadow hover:shadow-[0_0_20px_rgba(92,213,120,0.5)]"
                          style={{ background: "hsl(var(--primary))" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(`/events/${event.id}`);
                          }}
                        >
                          <ArrowUpRight className="w-5 h-5" />
                        </Magnetic>
                      </div>
                    </TiltCard>
                  </CarouselItem>
                ))}
              </CarouselContent>
            </Carousel>
            {pickedForYou.length > 1 && (
              <div className="flex justify-center gap-1.5">
                {pickedForYou.map((_, i) => (
                  <button
                    key={i}
                    aria-label={`Slide ${i + 1}`}
                    className={cn(
                      "w-1.5 h-1.5 rounded-full transition",
                      i === carouselIndex ? "bg-primary" : "bg-[var(--yrdly-glass-border)]"
                    )}
                    onClick={() => carouselApi?.scrollTo(i)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {/* Events in your Area */}
      <section className="space-y-3 sm:space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg sm:text-[1.125rem] leading-8 text-foreground font-yrdly-display font-bold">
            Events in your Area
          </h2>
          <Link
            href="/events"
            className="font-yrdly-body font-medium text-xs text-primary hover:underline flex-shrink-0"
          >
            See all
          </Link>
        </div>
        <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
          {inYourArea.map((event) => (
            <EventCardCompact
              key={event.id}
              event={{
                ...event,
                image_url: event.cover_image_url || (event as any).image_url,
                event_date: event.start_time,
                event_location: event.location_address,
                price: (event as any).price || 0,
              } as any}
              onPress={() => router.push(`/events/${event.id}`)}
            />
          ))}
        </div>
      </section>

      {/* Sort buttons - horizontal scroll on mobile */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide font-yrdly-body">
        <button
          onClick={() => setSortBy("all")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs flex-shrink-0 transition-all border",
            sortBy === "all"
              ? "bg-[var(--yrdly-glass-bg)] text-foreground border-[var(--yrdly-glass-border)] font-yrdly-display"
              : "bg-transparent text-[var(--yrdly-label)] border-[var(--yrdly-glass-border)] hover:text-foreground"
          )}
        >
          All Events
          <ChevronDown className="w-3 h-3" />
        </button>
        <button
          onClick={() => setSortBy("price")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs flex-shrink-0 transition-all border",
            sortBy === "price"
              ? "bg-[var(--yrdly-glass-bg)] text-foreground border-[var(--yrdly-glass-border)] font-yrdly-display"
              : "bg-transparent text-[var(--yrdly-label)] border-[var(--yrdly-glass-border)] hover:text-foreground"
          )}
        >
          Price
          <ChevronDown className="w-3 h-3" />
        </button>
        <button
          onClick={() => setSortBy("date")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs flex-shrink-0 transition-all border",
            sortBy === "date"
              ? "bg-[var(--yrdly-glass-bg)] text-foreground border-[var(--yrdly-glass-border)] font-yrdly-display"
              : "bg-transparent text-[var(--yrdly-label)] border-[var(--yrdly-glass-border)] hover:text-foreground"
          )}
        >
          Date
          <ChevronDown className="w-3 h-3" />
        </button>
      </div>

      {/* Mainstream / Grid Events */}
      <section className="space-y-4">
        {mainstream.length === 0 ? (
          <GlassCard className="flex flex-col items-center justify-center py-16 px-4 text-center rounded-2xl">
            <div className="w-12 h-12 rounded-full flex items-center justify-center mb-3 bg-primary/10">
              <CalendarDays className="w-6 h-6 text-primary" />
            </div>
            <h3 className="text-base font-bold font-yrdly-display text-foreground mb-1">No Events Found</h3>
            <p className="text-[var(--yrdly-label)] font-yrdly-body text-xs max-w-[280px]">Be the first to create an event in your neighborhood.</p>
          </GlassCard>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {mainstream.map((event, idx) => (
              <RevealOnScroll key={event.id} delay={(idx % 4) * 60}>
                <EventCard
                  event={{
                    ...event,
                    image_url: event.cover_image_url || (event as any).image_url,
                    event_date: event.start_time,
                    event_location: event.location_address,
                    price: (event as any).price || 0,
                    author_name: (event.organizer as any)?.name || (event as any).author_name,
                    author_image: (event.organizer as any)?.avatar_url || (event as any).author_image,
                  } as any}
                  onPress={() => router.push(`/events/${event.id}`)}
                />
              </RevealOnScroll>
            ))}
          </div>
        )}
      </section>



      {/* Event Creator Onboarding */}
      <EventCreatorOnboarding
        isOpen={onboardingOpen}
        onClose={() => setOnboardingOpen(false)}
        onContinue={() => router.push("/events/create")}
      />
    </div>
  );
}