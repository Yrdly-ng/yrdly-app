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
import { TiltCard } from "@/components/ui/TiltCard";
import { Magnetic } from "@/components/ui/Magnetic";
import { RevealOnScroll } from "@/components/ui/RevealOnScroll";

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

const QUICK_FILTERS = ["Today", "This Weekend", "Free", "Anime", "Music"] as const;
type QuickFilter = typeof QUICK_FILTERS[number];

function isToday(d: string | null | undefined): boolean {
  if (!d) return false;
  const date = new Date(d);
  const now = new Date();
  return date.toDateString() === now.toDateString();
}

function isThisWeekend(d: string | null | undefined): boolean {
  if (!d) return false;
  const date = new Date(d);
  const day = date.getDay();
  const now = new Date();
  const diffDays = Math.floor((date.getTime() - now.getTime()) / 86400000);
  return (day === 0 || day === 6) && diffDays >= 0 && diffDays <= 7;
}



export function EventsScreen({ className }: EventsScreenProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const { activeFilter } = useLocation();
  const filterState = activeFilter?.state;
  const filterLga = activeFilter?.lga;
  const filterWard = activeFilter?.ward;
  const [events, setEvents] = useState<Event[]>([]);
  const [rsvpLoading, setRsvpLoading] = useState<Set<string>>(new Set());
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<"date" | "price" | "all">("date");
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
          if (f === "This Weekend") return isThisWeekend(event.start_time);
          if (f === "Free") return !event.ticket_tiers?.length || event.ticket_tiers.every(t => t.price === 0);
          if (f === "Anime") return (event.category || "").toLowerCase().includes("anime");
          if (f === "Music") return (event.category || "").toLowerCase().includes("music") || (event.category || "").toLowerCase().includes("concert");
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
    <div className={cn("p-3 sm:p-4 md:p-6 space-y-6 md:space-y-8 pb-20 lg:pb-8", className)}>
      {/* Location + Quick filter bar */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
        <LocationChip />
        <div className="w-px h-5 bg-border flex-shrink-0" />
        {QUICK_FILTERS.map((filter) => {
          const active = activeQuickFilters.has(filter);
          return (
            <button
              key={filter}
              onClick={() => toggleQuickFilter(filter)}
              className={cn(
                "flex-shrink-0 px-3 py-1.5 rounded-full font-sans text-xs font-medium transition-all",
                active
                  ? "bg-primary text-foreground shadow-[0_4px_12px_rgba(92,213,120,0.35)]"
                  : "border border-border text-foreground hover:bg-accent"
              )}
            >
              {filter}
            </button>
          );
        })}
      </div>
      {/* Picked for You */}
      <section className="space-y-3 sm:space-y-4">
        <h2
          className="text-lg sm:text-[1.125rem] leading-8 text-foreground"
          style={{ fontFamily: "var(--font-jersey25)" }}
        >
          Picked for You
        </h2>
        {pickedForYou.length === 0 ? (
          <div
            className="rounded-[28px] h-[220px] sm:h-[280px] md:h-[330px] flex flex-col items-center justify-center gap-3 px-6"
            style={{ background: "var(--c-card)" }}
          >
            <CalendarDays className="w-12 h-12 text-muted-foreground" aria-hidden />
            <p className="text-muted-foreground font-sans text-sm text-center">No events picked for you yet</p>
            <p className="text-muted-foreground font-sans text-xs text-center max-w-[240px]">Create an event or check back later for recommendations.</p>
          </div>
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
                      className="w-full rounded-[20px] sm:rounded-[24px] overflow-hidden aspect-[820/340] max-h-[300px] sm:max-h-[350px] bg-card"
                      maxTilt={5}
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
                          className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-sans font-semibold text-white"
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
                        <h3 className="font-sans font-extrabold text-lg sm:text-[1.4375rem] text-white mb-2 drop-shadow-sm">
                          {event.title || "Event"}
                        </h3>
                        <div className="flex flex-wrap items-center gap-3 text-white/90 text-xs sm:text-[0.8125rem] font-sans">
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
                      i === carouselIndex ? "bg-primary" : "bg-[#D9D9D9]"
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
          <h2
            className="text-lg sm:text-[1.125rem] leading-8 text-foreground"
            style={{ fontFamily: "var(--font-jersey25)" }}
          >
            Events in your Area
          </h2>
          <Link
            href="/events"
            className="font-sans font-medium text-xs text-[#1976D2] hover:underline flex-shrink-0"
          >
            See all
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          {inYourArea.map((event) => {
            const { day, month } = dateChipParts(event.start_time);
            const isSaved = savedEvents.has(event.id);
            return (
              <div
                key={event.id}
                className="rounded-xl overflow-hidden cursor-pointer transition-all duration-300 hover:-translate-y-1"
                style={{ background: "var(--c-card)", boxShadow: "0 10px 30px rgba(0,0,0,0.06)" }}
                onClick={() => router.push(`/events/${event.id}`)}
              >
                <div className="p-3 flex gap-2">
                  <div className="relative w-14 h-14 rounded-lg flex-shrink-0 bg-background overflow-hidden">
                    <Image
                      src={event.cover_image_url || "/placeholder.svg"}
                      alt=""
                      width={56}
                      height={56}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute top-0.5 left-0.5 rounded-md px-1 py-0.5 text-center leading-none" style={{ background: "rgba(0,0,0,0.55)" }}>
                      <div className="text-white font-sans font-bold text-[0.5rem]">{day}</div>
                      <div className="text-white/80 font-sans text-[0.4rem]">{month}</div>
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-sans font-medium italic text-xs sm:text-[0.8125rem] text-foreground truncate">
                      {event.title || "Event"}
                    </p>
                    <p className="font-sans text-[0.5625rem] sm:text-[0.5625rem] text-foreground mt-0.5">
                      {formatEventDate(event.start_time)}
                    </p>
                    <div className="flex items-center gap-1 mt-1 text-muted-foreground">
                      <MapPin className="w-3 h-3 flex-shrink-0" />
                      <span className="font-sans text-[0.5625rem] sm:text-[0.6875rem] truncate">
                        {event.location_address || event.description?.slice(0, 30) || "—"}
                      </span>
                    </div>
                  </div>
                  <button
                    aria-label={isSaved ? "Unsave" : "Save"}
                    className="p-1 h-fit text-muted-foreground hover:text-primary transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSaved(event.id);
                    }}
                  >
                    <Heart className={cn("w-4 h-4", isSaved && "fill-primary text-primary")} />
                  </button>
                </div>
                <div className="px-3 pb-3 pt-0 border-t border-border">
                  {event.attendee_count && event.attendee_count > 0 ? (
                    <p className="font-sans text-[0.5625rem] text-muted-foreground mb-2 mt-2">
                      {event.attendee_count === 1 ? "1 person going" : `${event.attendee_count} people going`}
                    </p>
                  ) : (
                    <p className="font-sans text-[0.5625rem] text-muted-foreground mb-2 mt-2">
                      Be the first to RSVP
                    </p>
                  )}
                  <Button
                    size="sm"
                    className="w-full rounded-[15px] font-sans text-[0.6875rem] text-foreground transition-shadow hover:shadow-[0_0_16px_rgba(92,213,120,0.45)]"
                    style={{ background: "hsl(var(--primary))" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      router.push(`/events/${event.id}`);
                    }}
                  >
                    Get Ticket
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Sort buttons - horizontal scroll on mobile */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
        <button
          onClick={() => setSortBy("all")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 rounded-md font-sans text-[0.625rem] sm:text-xs flex-shrink-0 transition-all",
            sortBy === "all" ? "bg-foreground text-background" : "text-foreground"
          )}
          style={sortBy !== "all" ? { boxShadow: "0 2px 8px rgba(0,0,0,0.06)" } : undefined}
        >
          All Events
          <ChevronDown className="w-3 h-3" />
        </button>
        <button
          onClick={() => setSortBy("price")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 rounded-md font-sans text-[0.625rem] sm:text-xs flex-shrink-0 transition-all",
            sortBy === "price" ? "bg-foreground text-background" : "text-foreground"
          )}
          style={sortBy !== "price" ? { boxShadow: "0 2px 8px rgba(0,0,0,0.06)" } : undefined}
        >
          Price
          <ChevronDown className="w-3 h-3" />
        </button>
        <button
          onClick={() => setSortBy("date")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 rounded-md font-sans text-[0.625rem] sm:text-xs flex-shrink-0 transition-all",
            sortBy === "date" ? "bg-foreground text-background" : "text-foreground"
          )}
          style={sortBy !== "date" ? { boxShadow: "0 2px 8px rgba(0,0,0,0.06)" } : undefined}
        >
          Date
          <ChevronDown className="w-3 h-3" />
        </button>
      </div>

      {/* Mainstream Events */}
      <section className="space-y-4">
        <h2
          className="text-lg sm:text-[1.125rem] leading-8 text-foreground"
          style={{ fontFamily: "var(--font-jersey25)" }}
        >
          Mainstream Events
        </h2>
        {mainstream.length === 0 ? (
          <div
            className="rounded-[11px] py-16 px-6 flex flex-col items-center justify-center gap-3"
            style={{ background: "var(--c-card)" }}
          >
            <CalendarDays className="w-14 h-14 text-muted-foreground" aria-hidden />
            <p className="text-muted-foreground font-sans text-sm text-center">No events yet</p>
            <p className="text-muted-foreground font-sans text-xs text-center max-w-[280px]">Be the first to create an event in your neighborhood.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {mainstream.map((event, idx) => {
              const { day, month } = dateChipParts(event.start_time);
              const isSaved = savedEvents.has(event.id);
              return (
              <RevealOnScroll key={event.id} delay={(idx % 4) * 60}>
              <div
                className="rounded-2xl overflow-hidden cursor-pointer transition-all duration-300 hover:-translate-y-1"
                style={{ background: "var(--c-card)", boxShadow: "0 10px 30px rgba(0,0,0,0.06)" }}
                onClick={() => router.push(`/events/${event.id}`)}
              >
                <div className="p-4 sm:p-5">
                  {event.organizer && (
                    <div className="flex items-center gap-2 mb-3">
                      <Avatar className="w-8 h-8">
                        <AvatarImage src={(event.organizer as any)?.avatar_url} />
                        <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                          {(event.organizer as any)?.name?.slice(0, 1) || "U"}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-sans font-bold text-sm text-foreground">
                          {(event.organizer as any)?.name}
                        </p>
                        <p className="font-sans text-[0.6875rem] text-muted-foreground">
                          {timeAgo(event.created_at ? new Date(event.created_at) : null)}
                        </p>
                      </div>
                    </div>
                  )}
                  <h3 className="font-sans font-extrabold text-base sm:text-lg text-foreground mb-3">
                    {event.title || "Event"}
                  </h3>
                  <div className="relative w-full aspect-[434/262] rounded-[15px] overflow-hidden bg-background mb-4">
                    <Image
                      src={event.cover_image_url || "/placeholder.svg"}
                      alt={event.title || "Event"}
                      fill
                      className="object-cover"
                      sizes="(max-width: 768px) 100vw, 50vw"
                    />
                    {/* Date chip overlay */}
                    <div className="absolute top-2.5 left-2.5 rounded-lg px-2 py-1 text-center leading-none" style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}>
                      <div className="text-white font-sans font-bold text-xs">{day}</div>
                      <div className="text-white/80 font-sans text-[0.5625rem]">{month}</div>
                    </div>
                    {/* Action buttons overlay */}
                    <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5">
                      <button
                        aria-label={isSaved ? "Unsave" : "Save"}
                        className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
                        style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)" }}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSaved(event.id);
                        }}
                      >
                        <Heart className={cn("w-4 h-4 text-white", isSaved && "fill-white")} />
                      </button>
                      <button
                        aria-label="Share"
                        className="w-8 h-8 rounded-full flex items-center justify-center"
                        style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)" }}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (navigator.share) {
                            navigator.share({
                              title: event.title || "Event",
                              url: window.location.origin + `/events/${event.id}`,
                            });
                          } else {
                            navigator.clipboard.writeText(window.location.origin + `/events/${event.id}`);
                            toast({ title: "Link copied" });
                          }
                        }}
                      >
                        <Share2 className="w-4 h-4 text-white" />
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2 text-foreground font-sans text-[0.8125rem]">
                    <div className="flex items-center gap-2">
                      <CalendarDays className="w-4 h-4 flex-shrink-0" />
                      {formatEventDateTime(event.start_time)}
                    </div>
                    <div className="flex items-center gap-2 truncate">
                      <MapPin className="w-4 h-4 flex-shrink-0" />
                      {event.location_address || "Online"}
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-4">
                    <span className="font-sans font-bold text-xl sm:text-2xl text-primary">
                      {event.ticket_tiers && event.ticket_tiers.length > 0
                        ? `From ₦${Math.min(...event.ticket_tiers.map(t => t.price)).toLocaleString()}`
                        : "Free"}
                    </span>
                    {event.attendee_count && event.attendee_count > 0 ? (
                      <div className="flex items-center gap-1.5">
                        <div className="flex -space-x-2">
                          {Array.from({ length: Math.min(3, event.attendee_count) }).map((_, i) => (
                            <div
                              key={i}
                              className="w-5 h-5 rounded-full border-2 border-[var(--c-card)] flex items-center justify-center text-[0.5rem] font-sans font-bold text-primary-foreground"
                              style={{ background: "hsl(var(--primary))" }}
                            >
                              {String.fromCharCode(65 + i)}
                            </div>
                          ))}
                        </div>
                        <span className="font-sans text-[0.6875rem] text-muted-foreground">
                          {event.attendee_count > 3 ? `+${event.attendee_count - 3} going` : "going"}
                        </span>
                      </div>
                    ) : (
                      <span className="font-sans text-[0.6875rem] text-muted-foreground">Be the first to join</span>
                    )}
                  </div>
                </div>
              </div>
              </RevealOnScroll>
              );
            })}
          </div>
        )}
      </section>

      {/* Floating Create */}
      <div className="fixed bottom-20 right-4 z-40 lg:bottom-6">
        <Button
          size="lg"
          className="rounded-full h-12 w-12 sm:h-14 sm:w-14 shadow-lg p-0"
          style={{ background: "hsl(var(--primary))" }}
          onClick={() => setOnboardingOpen(true)}
        >
          <Plus className="h-6 w-6 text-foreground" />
        </Button>
      </div>

      {/* Event Creator Onboarding */}
      <EventCreatorOnboarding
        isOpen={onboardingOpen}
        onClose={() => setOnboardingOpen(false)}
      />
    </div>
  );
}