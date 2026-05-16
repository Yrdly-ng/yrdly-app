"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import {
  CalendarDays, MapPin, Clock, Users, Ticket, ArrowLeft,
  Share2, Globe, ChevronLeft, ChevronRight, Loader2, CheckCircle2, AlertCircle
} from "lucide-react";
import { ImageSwiper } from "@/components/ImageSwiper";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { getEventById } from "@/lib/event-service";
import type { Event, TicketTier } from "@/types/events";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-NG", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
}
function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" });
}
function formatPrice(naira: number) {
  return naira === 0 ? "Free" : `₦${naira.toLocaleString()}`;
}

interface PurchaseState {
  step: "idle" | "form" | "loading" | "success" | "error";
  tier: TicketTier | null;
  errorMsg: string;
}

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();

  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [purchase, setPurchase] = useState<PurchaseState>({ step: "idle", tier: null, errorMsg: "" });
  const [form, setForm] = useState({ name: "", email: "", phone: "" });
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    getEventById(id).then((e) => {
      setEvent(e);
      setLoading(false);
    });
  }, [id]);

  // Pre-fill form with auth user data
  useEffect(() => {
    if (user) {
      setForm((f) => ({
        ...f,
        name: user.user_metadata?.name || f.name,
        email: user.email || f.email,
      }));
    }
  }, [user]);

  const handleSelectTier = (tier: TicketTier) => {
    if (!user) { router.push("/login"); return; }
    setPurchase({ step: "form", tier, errorMsg: "" });
  };

  const handlePurchase = async () => {
    if (!purchase.tier) return;
    
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setPurchase((s) => ({ ...s, errorMsg: "You must be logged in." }));
      return;
    }

    if (!form.name.trim() || !form.email.trim()) {
      setPurchase((s) => ({ ...s, errorMsg: "Name and email are required." }));
      return;
    }
    setPurchase((s) => ({ ...s, step: "loading", errorMsg: "" }));

    try {
      const res = await fetch("/api/events/tickets/purchase", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          event_id: id,
          tier_id: purchase.tier.id,
          attendee_name: form.name.trim(),
          attendee_email: form.email.trim(),
          attendee_phone: form.phone.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const errorMsg = data.message || data.error || data.details || "Purchase failed";
        throw new Error(errorMsg);
      }

      if (data.free) {
        // Free ticket — go straight to my-tickets
        setPurchase((s) => ({ ...s, step: "success" }));
        setTimeout(() => router.push("/my-tickets?success=1"), 1500);
      } else {
        // Paid — redirect to Flutterwave
        window.location.href = data.payment_link;
      }
    } catch (err: any) {
      setPurchase((s) => ({ ...s, step: "form", errorMsg: err.message }));
    }
  };

  const handleShare = () => {
    const url = window.location.href;
    if (navigator.share) {
      navigator.share({ title: event?.title, url });
    } else {
      navigator.clipboard.writeText(url);
      toast({ title: "Link copied!" });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#15181D] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#388E3C] animate-spin" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-screen bg-[#15181D] flex flex-col items-center justify-center gap-4 text-white p-6">
        <AlertCircle className="w-12 h-12 text-red-400" />
        <p className="font-raleway text-lg">Event not found</p>
        <Button onClick={() => router.push("/events")} variant="outline" className="border-white/20 text-white">
          Back to Events
        </Button>
      </div>
    );
  }

  const isOrganizer = user?.id === event.organizer_id;
  const isCancelled = event.status === "CANCELLED";
  const tiers = event.ticket_tiers || [];

  // Collect all images: image_urls array > cover_image_url fallback
  const eventImages: string[] = (event as any).image_urls?.length
    ? (event as any).image_urls
    : event.cover_image_url
    ? [event.cover_image_url]
    : [];

  const hasMultipleImages = eventImages.length > 1;

  return (
    <div className="min-h-screen bg-[#15181D] text-white pb-24">
      {/* Hero Carousel */}
      <div className="relative w-full aspect-[16/7] max-h-[420px] bg-[#1E2126] overflow-hidden">
        {eventImages.length > 0 ? (
          <>
            {/* Images — touch-swipeable strip */}
            <div
              className="absolute inset-0 flex transition-transform duration-300 ease-out"
              style={{ transform: `translateX(-${activeImageIndex * 100}%)` }}
            >
              {eventImages.map((src, i) => (
                <div key={i} className="relative w-full h-full flex-shrink-0 cursor-pointer" onClick={() => setLightboxOpen(true)}>
                  <Image src={src} alt={`${event.title} — image ${i + 1}`} fill className="object-cover" priority={i === 0} />
                </div>
              ))}
            </div>

            {/* Prev/Next arrows — only when multiple */}
            {hasMultipleImages && (
              <>
                <button
                  onClick={() => setActiveImageIndex((p) => (p - 1 + eventImages.length) % eventImages.length)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center z-10"
                >
                  <ChevronLeft className="w-4 h-4 text-white" />
                </button>
                <button
                  onClick={() => setActiveImageIndex((p) => (p + 1) % eventImages.length)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center z-10"
                >
                  <ChevronRight className="w-4 h-4 text-white" />
                </button>
              </>
            )}

            {/* Dot indicators */}
            {hasMultipleImages && (
              <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
                {eventImages.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveImageIndex(i)}
                    className={`rounded-full transition-all duration-200 ${
                      i === activeImageIndex ? "w-4 h-1.5 bg-white" : "w-1.5 h-1.5 bg-white/40"
                    }`}
                  />
                ))}
              </div>
            )}

            {/* Counter pill */}
            {hasMultipleImages && (
              <div className="absolute bottom-3 right-3 bg-black/50 backdrop-blur-sm text-white text-xs font-raleway px-2 py-1 rounded-full z-10">
                {activeImageIndex + 1} / {eventImages.length}
              </div>
            )}
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <CalendarDays className="w-24 h-24 text-white/10" />
          </div>
        )}

        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#15181D] via-[#15181D]/10 to-transparent pointer-events-none" />

        {/* Top nav */}
        <div className="absolute top-4 left-4 right-4 flex items-center justify-between z-10">
          <button
            onClick={() => router.back()}
            className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center"
          >
            <ArrowLeft className="w-5 h-5 text-white" />
          </button>
          <div className="flex items-center gap-2">
            {isOrganizer && (
              <Link href={`/events/${id}/manage`}>
                <button className="px-4 py-2 rounded-full bg-[#388E3C]/90 backdrop-blur-sm text-xs font-raleway font-medium text-white">
                  Manage Event
                </button>
              </Link>
            )}
            <button
              onClick={handleShare}
              className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center"
            >
              <Share2 className="w-4 h-4 text-white" />
            </button>
          </div>
        </div>

        {/* Status badge */}
        {isCancelled && (
          <div className="absolute top-16 left-4 z-10">
            <Badge className="bg-red-500/90 text-white border-0 font-raleway">Cancelled</Badge>
          </div>
        )}
      </div>

      {/* Lightbox */}
      {eventImages.length > 0 && (
        <ImageSwiper
          images={eventImages}
          isOpen={lightboxOpen}
          onClose={() => setLightboxOpen(false)}
          initialIndex={activeImageIndex}
        />
      )}

      <div className="max-w-2xl mx-auto px-4 pt-6 space-y-6">
        {/* Title & category */}
        <div>
          <Badge className="bg-[#388E3C]/20 text-[#4CAF50] border-[#388E3C]/30 text-xs font-raleway mb-3">
            {event.category}
          </Badge>
          <h1 className="font-raleway font-extrabold text-2xl sm:text-3xl text-white leading-tight">
            {event.title}
          </h1>
        </div>

        {/* Meta info */}
        <div className="space-y-3">
          <div className="flex items-start gap-3 text-white/80">
            <CalendarDays className="w-5 h-5 flex-shrink-0 mt-0.5 text-[#388E3C]" />
            <div>
              <p className="font-raleway font-medium text-sm">{formatDate(event.start_time)}</p>
              <p className="font-raleway text-xs text-white/60">
                {formatTime(event.start_time)}
                {event.end_time && ` – ${formatTime(event.end_time)}`}
              </p>
            </div>
          </div>

          {(event.location_address || event.state) && (
            <div className="flex items-start gap-3 text-white/80">
              <MapPin className="w-5 h-5 flex-shrink-0 mt-0.5 text-[#388E3C]" />
              <div>
                <p className="font-raleway font-medium text-sm">
                  {event.location_online ? "Online Event" : (event.location_address || event.state)}
                </p>
                {event.lga && (
                  <p className="font-raleway text-xs text-white/60">{event.lga}{event.state ? `, ${event.state}` : ""}</p>
                )}
              </div>
            </div>
          )}

          {event.location_online && event.online_link && (
            <div className="flex items-center gap-3 text-white/80">
              <Globe className="w-5 h-5 flex-shrink-0 text-[#388E3C]" />
              <a href={event.online_link} target="_blank" rel="noopener noreferrer"
                className="font-raleway text-sm text-[#4CAF50] underline underline-offset-2 truncate">
                Join Online
              </a>
            </div>
          )}

          <div className="flex items-center gap-3 text-white/80">
            <Users className="w-5 h-5 flex-shrink-0 text-[#388E3C]" />
            <p className="font-raleway text-sm">{event.attendee_count} attending</p>
          </div>
        </div>

        <Separator className="bg-white/10" />

        {/* Organizer */}
        <div className="flex items-center gap-3">
          <Avatar className="w-10 h-10 border border-white/10">
            <AvatarImage src={(event.organizer as any)?.avatar_url} />
            <AvatarFallback className="bg-[#388E3C] text-white text-sm">
              {(event.organizer as any)?.name?.charAt(0) || "O"}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="font-raleway text-xs text-white/50">Organised by</p>
            <p className="font-raleway font-semibold text-sm text-white">{(event.organizer as any)?.name || "Organizer"}</p>
          </div>
        </div>

        <Separator className="bg-white/10" />

        {/* Description */}
        {event.description && (
          <div>
            <h2 className="font-raleway font-bold text-base text-white mb-2">About this Event</h2>
            <p className="font-raleway text-sm text-white/70 leading-relaxed whitespace-pre-wrap">{event.description}</p>
          </div>
        )}

        {/* Ticket Tiers */}
        {!isCancelled && tiers.length > 0 && (
          <div>
            <h2 className="font-raleway font-bold text-base text-white mb-3">Tickets</h2>
            <div className="space-y-3">
              {tiers.filter(t => t.is_visible).map((tier) => {
                const soldOut = tier.capacity !== null && tier.sold >= tier.capacity;
                return (
                  <div
                    key={tier.id}
                    className="rounded-2xl border border-white/10 bg-[#1E2126] p-4 flex items-center justify-between gap-4"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-raleway font-bold text-sm text-white">{tier.name}</p>
                      {tier.description && (
                        <p className="font-raleway text-xs text-white/50 mt-0.5 truncate">{tier.description}</p>
                      )}
                      {tier.capacity !== null && (
                        <p className="font-raleway text-xs text-white/40 mt-1">
                          {Math.max(0, tier.capacity - tier.sold)} left
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="font-raleway font-bold text-[#4CAF50] text-base">
                        {formatPrice(tier.price)}
                      </span>
                      <Button
                        size="sm"
                        disabled={soldOut || isOrganizer}
                        onClick={() => handleSelectTier(tier)}
                        className="rounded-full font-raleway text-xs text-white px-4"
                        style={{ background: soldOut ? "#374151" : "#388E3C" }}
                      >
                        {soldOut ? "Sold Out" : isOrganizer ? "Yours" : "Get"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Purchase drawer overlay */}
      {(purchase.step === "form" || purchase.step === "loading" || purchase.step === "success") && (
        <div
          className="fixed inset-0 z-50 flex items-end"
          onClick={() => purchase.step === "form" && setPurchase({ step: "idle", tier: null, errorMsg: "" })}
        >
          {/* Scrim */}
          <div className="absolute inset-0 bg-black/60" />

          <div
            className="relative w-full max-w-lg mx-auto rounded-t-3xl bg-[#1E2126] border border-white/10 shadow-2xl flex flex-col overflow-hidden"
            style={{ maxHeight: "92dvh" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
              <div className="w-10 h-1 rounded-full bg-white/20" />
            </div>

            {/* Scrollable body */}
            <div
              className="overflow-y-auto flex-1 px-6 pt-3 space-y-5"
              style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}
            >
              {purchase.step === "success" ? (
                <div className="flex flex-col items-center gap-3 py-8">
                  <CheckCircle2 className="w-14 h-14 text-[#4CAF50]" />
                  <p className="font-raleway font-bold text-lg text-white">Ticket Confirmed!</p>
                  <p className="font-raleway text-sm text-white/60">Redirecting to your tickets…</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <h3 className="font-raleway font-bold text-base text-white">
                      {purchase.tier?.name} — {formatPrice(purchase.tier?.price || 0)}
                    </h3>
                    <button
                      onClick={() => setPurchase({ step: "idle", tier: null, errorMsg: "" })}
                      className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/20 transition"
                    >
                      <ChevronRight className="w-4 h-4 rotate-90" />
                    </button>
                  </div>

                  <div className="space-y-3">
                    <input
                      className="w-full bg-[#15181D] border border-white/10 rounded-xl px-4 py-3 text-white font-raleway text-sm placeholder:text-white/30 outline-none focus:border-[#388E3C]"
                      placeholder="Full Name *"
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    />
                    <input
                      className="w-full bg-[#15181D] border border-white/10 rounded-xl px-4 py-3 text-white font-raleway text-sm placeholder:text-white/30 outline-none focus:border-[#388E3C]"
                      placeholder="Email Address *"
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    />
                    <input
                      className="w-full bg-[#15181D] border border-white/10 rounded-xl px-4 py-3 text-white font-raleway text-sm placeholder:text-white/30 outline-none focus:border-[#388E3C]"
                      placeholder="Phone (optional)"
                      type="tel"
                      value={form.phone}
                      onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    />
                  </div>

                  {purchase.errorMsg && (
                    <p className="font-raleway text-xs text-red-400 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> {purchase.errorMsg}
                    </p>
                  )}

                  <Button
                    className="w-full rounded-full h-12 font-raleway font-medium text-white text-sm"
                    style={{ background: "#388E3C" }}
                    disabled={purchase.step === "loading"}
                    onClick={handlePurchase}
                  >
                    {purchase.step === "loading" ? (
                      <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Processing…</>
                    ) : purchase.tier?.price === 0 ? "Get Free Ticket" : `Pay ${formatPrice(purchase.tier?.price || 0)}`}
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
