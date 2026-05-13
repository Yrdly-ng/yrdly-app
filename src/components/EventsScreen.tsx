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



export function EventsScreen({ className }: EventsScreenProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const { filterState, filterLga } = useLocation();
  const [events, setEvents] = useState<Event[]>([]);
  const [rsvpLoading, setRsvpLoading] = useState<Set<string>>(new Set());
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<"date" | "price" | "all">("date");
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [carouselApi, setCarouselApi] = useState<CarouselApi | null>(null);

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
        });
        setEvents(data);
      } catch (err) {
        console.error("Failed to fetch events", err);
      } finally {
        setLoading(false);
      }
    };
    fetchEvents();
  }, [filterState, filterLga]);

  const filteredAndSorted = useMemo(() => {
    let list = [...events];
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
  }, [events, sortBy]);

  const pickedForYou = filteredAndSorted.slice(0, 5);
  const inYourArea = filteredAndSorted.slice(0, 3);
  const mainstream = filteredAndSorted;

  if (loading) {
    return (
      <div className={cn("p-4 space-y-6", className)}>
        <Skeleton className="h-[280px] sm:h-[330px] w-full rounded-[28px]" style={{ background: "#1E2126" }} />
        <Skeleton className="h-8 w-32" style={{ background: "#1E2126" }} />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[200px] rounded" style={{ background: "#1E2126" }} />
          ))}
        </div>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-8 w-20 flex-shrink-0 rounded-md" style={{ background: "#1E2126" }} />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-[400px] rounded-[11px]" style={{ background: "#1E2126" }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("p-3 sm:p-4 md:p-6 space-y-6 md:space-y-8 pb-20 lg:pb-8", className)}>
      {/* Location filter */}
      <div className="flex items-center gap-2">
        <LocationChip />
      </div>
      {/* Picked for You */}
      <section className="space-y-3 sm:space-y-4">
        <h2
          className="text-lg sm:text-[18px] leading-8 text-white"
          style={{ fontFamily: '"Pacifico", cursive' }}
        >
          Picked for You
        </h2>
        {pickedForYou.length === 0 ? (
          <div
            className="rounded-[28px] h-[220px] sm:h-[280px] md:h-[330px] flex flex-col items-center justify-center gap-3 px-6"
            style={{ background: "#1E2126" }}
          >
            <CalendarDays className="w-12 h-12 text-white/30" aria-hidden />
            <p className="text-white/70 font-raleway text-sm text-center">No events picked for you yet</p>
            <p className="text-white/50 font-raleway text-xs text-center max-w-[240px]">Create an event or check back later for recommendations.</p>
          </div>
        ) : (
          <>
            <Carousel
              opts={{ align: "center", loop: true }}
              className="w-full"
              setApi={setCarouselApi}
            >
              <CarouselContent className="-ml-2 sm:-ml-4">
                {pickedForYou.map((event) => (
                  <CarouselItem
                    key={event.id}
                    className="pl-2 sm:pl-4 basis-full sm:basis-[85%] md:basis-[75%] lg:basis-[70%]"
                  >
                    <div
                      className="relative w-full rounded-[28px] overflow-hidden aspect-[820/330] max-h-[280px] sm:max-h-[330px] bg-[#1E2126]"
                      onClick={() => router.push(`/events/${event.id}`)}
                    >
                      <Image
                        src={event.cover_image_url || "/placeholder.svg"}
                        alt={event.title || "Event"}
                        fill
                        className="object-cover"
                        sizes="(max-width: 768px) 100vw, 75vw"
                      />
                      <div
                        className="absolute inset-0 rounded-[28px]"
                        style={{
                          background: "rgba(56,56,56,0.43)",
                          backdropFilter: "blur(8.4px)",
                        }}
                      />
                      <div className="absolute inset-0 flex flex-col justify-end p-4 sm:p-6 md:p-8">
                        <h3 className="font-raleway font-extrabold text-lg sm:text-[23px] text-white mb-2">
                          {event.title || "Event"}
                        </h3>
                        <div className="flex flex-wrap items-center gap-3 text-white/90 text-xs sm:text-[13px] font-raleway">
                          <span className="flex items-center gap-1">
                            <CalendarDays className="w-4 h-4" />
                            {formatEventDateTime(event.start_time)}
                          </span>
                          <span className="flex items-center gap-1 truncate">
                            <MapPin className="w-4 h-4 flex-shrink-0" />
                            {event.location_address || "Online"}
                          </span>
                        </div>
                        <Button
                          className="mt-4 w-full sm:w-auto sm:min-w-[180px] rounded-full font-raleway font-medium text-sm text-white border border-white/80"
                          style={{ background: "#388E3C" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(`/events/${event.id}`);
                          }}
                        >
                          Get Ticket
                        </Button>
                      </div>
                    </div>
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
                      i === carouselIndex ? "bg-[#388E3C]" : "bg-[#D9D9D9]"
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
            className="text-lg sm:text-[18px] leading-8 text-white"
            style={{ fontFamily: '"Pacifico", cursive' }}
          >
            Events in your Area
          </h2>
          <Link
            href="/events"
            className="font-raleway font-medium text-xs text-[#1976D2] hover:underline flex-shrink-0"
          >
            See all
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          {inYourArea.map((event) => (
            <div
              key={event.id}
              className="rounded overflow-hidden cursor-pointer transition hover:opacity-95"
              style={{ background: "#1E2126" }}
              onClick={() => router.push(`/events/${event.id}`)}
            >
              <div className="p-3 flex gap-2">
                <div className="w-14 h-14 rounded flex-shrink-0 bg-[#15181D] overflow-hidden">
                  <Image
                    src={event.cover_image_url || "/placeholder.svg"}
                    alt=""
                    width={56}
                    height={56}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-raleway font-medium italic text-xs sm:text-[13px] text-white truncate">
                    {event.title || "Event"}
                  </p>
                  <p className="font-raleway text-[9px] sm:text-[9px] text-white/80 mt-0.5">
                    {formatEventDate(event.start_time)}
                  </p>
                  <div className="flex items-center gap-1 mt-1 text-white/70">
                    <MapPin className="w-3 h-3 flex-shrink-0" />
                    <span className="font-raleway text-[9px] sm:text-[11px] truncate">
                      {event.location_address || event.description?.slice(0, 30) || "—"}
                    </span>
                  </div>
                </div>
              </div>
              <div className="px-3 pb-3 pt-0 border-t border-white/10">
                <p className="font-raleway text-[9px] text-white/60 mb-2">
                  {event.attendee_count || 0} are interested
                </p>
                <Button
                  size="sm"
                  className="w-full rounded-[15px] font-raleway text-[11px] text-white"
                  style={{ background: "#388E3C" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    router.push(`/events/${event.id}`);
                  }}
                >
                  Get Ticket
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Sort buttons - horizontal scroll on mobile */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
        <button
          onClick={() => setSortBy("all")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 rounded-md font-raleway text-[10px] sm:text-xs flex-shrink-0",
            sortBy === "all" ? "bg-white text-black" : "border border-white/50 text-white"
          )}
        >
          All Events
          <ChevronDown className="w-3 h-3" />
        </button>
        <button
          onClick={() => setSortBy("price")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 rounded-md font-raleway text-[10px] sm:text-xs flex-shrink-0",
            sortBy === "price" ? "bg-white text-black" : "border border-white/50 text-white"
          )}
        >
          Price
          <ChevronDown className="w-3 h-3" />
        </button>
        <button
          onClick={() => setSortBy("date")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 rounded-md font-raleway text-[10px] sm:text-xs flex-shrink-0",
            sortBy === "date" ? "bg-white text-black" : "border border-white/50 text-white"
          )}
        >
          Date
          <ChevronDown className="w-3 h-3" />
        </button>
      </div>

      {/* Mainstream Events */}
      <section className="space-y-4">
        <h2
          className="text-lg sm:text-[18px] leading-8 text-white"
          style={{ fontFamily: '"Pacifico", cursive' }}
        >
          Mainstream Events
        </h2>
        {mainstream.length === 0 ? (
          <div
            className="rounded-[11px] py-16 px-6 flex flex-col items-center justify-center gap-3"
            style={{ background: "#1E2126" }}
          >
            <CalendarDays className="w-14 h-14 text-white/30" aria-hidden />
            <p className="text-white/70 font-raleway text-sm text-center">No events yet</p>
            <p className="text-white/50 font-raleway text-xs text-center max-w-[280px]">Be the first to create an event in your neighborhood.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {mainstream.map((event) => (
              <div
                key={event.id}
                className="rounded-[11px] overflow-hidden cursor-pointer transition hover:opacity-95"
                style={{ background: "#1E2126" }}
                onClick={() => router.push(`/events/${event.id}`)}
              >
                <div className="p-4 sm:p-5">
                  {event.organizer && (
                    <div className="flex items-center gap-2 mb-3">
                      <Avatar className="w-8 h-8">
                        <AvatarImage src={(event.organizer as any)?.avatar_url} />
                        <AvatarFallback className="bg-[#388E3C] text-white text-xs">
                          {(event.organizer as any)?.name?.slice(0, 1) || "U"}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-raleway font-bold text-sm text-white">
                          {(event.organizer as any)?.name}
                        </p>
                        <p className="font-raleway text-[11px] text-white/60">
                          {timeAgo(event.created_at ? new Date(event.created_at) : null)}
                        </p>
                      </div>
                    </div>
                  )}
                  <h3 className="font-raleway font-extrabold text-base sm:text-lg text-white mb-3">
                    {event.title || "Event"}
                  </h3>
                  <div className="relative w-full aspect-[434/262] rounded-[15px] overflow-hidden bg-[#15181D] mb-4">
                    <Image
                      src={event.cover_image_url || "/placeholder.svg"}
                      alt={event.title || "Event"}
                      fill
                      className="object-cover"
                      sizes="(max-width: 768px) 100vw, 50vw"
                    />
                  </div>
                  <div className="space-y-2 text-white/90 font-raleway text-[13px]">
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
                    <span className="font-raleway font-bold text-xl sm:text-2xl text-[#388E3C]">
                      {event.ticket_tiers && event.ticket_tiers.length > 0
                        ? `From ₦${Math.min(...event.ticket_tiers.map(t => t.price)).toLocaleString()}`
                        : "Free"}
                    </span>
                    <button
                      className="p-2 text-white hover:bg-white/10 rounded-full"
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
                      <Share2 className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Floating Create */}
      <div className="fixed bottom-20 right-4 z-40 lg:bottom-6">
        <Button
          size="lg"
          className="rounded-full h-12 w-12 sm:h-14 sm:w-14 shadow-lg p-0"
          style={{ background: "#388E3C" }}
          onClick={() => setOnboardingOpen(true)}
        >
          <Plus className="h-6 w-6 text-white" />
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
