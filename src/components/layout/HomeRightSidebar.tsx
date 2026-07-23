"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { supabase } from "@/lib/supabase";
import { MapPin, Users, Zap, DollarSign } from "lucide-react";
import type { Post } from "@/types";
import { useAuth } from "@/hooks/use-supabase-auth";
import { TiltCard } from "@/components/ui/TiltCard";
import { AnimatePresence, motion } from "framer-motion";

const FONT_RALEWAY = "var(--font-raleway)";

type EventPost = Post & { user?: { name?: string; avatar_url?: string } };
type SalePost = Post & { user?: { name?: string; avatar_url?: string } };

function getLocation(loc: unknown) {
  if (!loc || typeof loc !== "object") return "";
  const o = loc as Record<string, unknown>;
  return typeof o.address === "string" ? o.address : "";
}

function DateBadge({ d }: { d: string | null | undefined }) {
  if (!d) return null;
  let month = "";
  let day = "";
  try {
    const date = new Date(d);
    month = date.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
    day = String(date.getDate());
  } catch {
    return null;
  }
  return (
    <div className="absolute top-3 left-3 flex flex-col items-center justify-center w-12 h-12 rounded-[0.75rem] bg-[var(--c-card)]/95 backdrop-blur-sm shadow-[0_4px_12px_rgba(0,0,0,0.2)] overflow-hidden">
      <span className="text-[0.6rem] font-bold leading-none text-[#ED1111] pt-1.5">{month}</span>
      <span className="text-[1.1rem] font-extrabold leading-none text-[var(--c-text)] pb-1.5" style={{ fontFamily: FONT_RALEWAY }}>
        {day}
      </span>
    </div>
  );
}

function EventCard({ event }: { event: EventPost }) {
  let safeLink = `/posts/${event.id}`;
  const rawLink = (event as any).event_link;

  if (rawLink) {
    if (rawLink.startsWith("yrdly://events/")) {
      const parts = rawLink.split("/");
      safeLink = `/posts/${parts.pop() || event.id}`;
    } else if (rawLink.startsWith("http")) {
      try {
        const url = new URL(rawLink);
        safeLink = url.pathname + url.search;
      } catch {
        safeLink = rawLink;
      }
    } else {
      safeLink = rawLink;
    }
  }

  const title = event.title || event.text?.split("\n")[0] || "Event";
  const location = getLocation(event.event_location);
  const imageUrl = event.image_urls?.[0] || event.image_url || "";
  const attendeeCount = event.attendees?.length ?? 0;

  return (
    <Link
      href={safeLink}
      className="group block w-full rounded-[1.5rem] overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.12)] border border-[var(--c-border)] bg-[var(--c-card)] transition-transform duration-300 hover:-translate-y-1"
    >
      <div className="relative w-full overflow-hidden bg-[var(--c-card2)]" style={{ aspectRatio: "16 / 9" }}>
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={title}
            fill
            className="object-cover post-media-image transition-transform duration-500 group-hover:scale-105"
            sizes="380px"
          />
        ) : (
          <div className="absolute inset-0 bg-[var(--secondary)]" />
        )}
        {/* Bottom dark gradient so overlaid badges/text stay legible */}
        <div
          className="absolute inset-0"
          style={{ background: "linear-gradient(to top, rgba(15, 23, 42, 0.95), transparent 60%)" }}
        />
        <DateBadge d={event.event_date} />
        <div className="absolute bottom-2.5 left-3 right-3">
          <p className="text-[1.05rem] font-bold text-white truncate drop-shadow-sm tracking-tight" style={{ fontFamily: FONT_RALEWAY }}>
            {title}
          </p>
        </div>
      </div>

      <div className="p-4">
        <div className="flex flex-wrap items-center gap-2 text-[0.8rem] text-[var(--c-text-muted)]" style={{ fontFamily: FONT_RALEWAY }}>
          {location && (
            <span className="inline-flex items-center gap-1 max-w-full rounded-full bg-[#DCFCE7] text-[#15803D] border border-[#BBF7D0] dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-900/60 px-2.5 py-1 font-medium">
              <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">{location}</span>
            </span>
          )}
          {attendeeCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#DCFCE7] text-[#15803D] border border-[#BBF7D0] dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-900/60 px-2.5 py-1 font-medium flex-shrink-0">
              <Users className="w-3.5 h-3.5 flex-shrink-0" />
              {attendeeCount} going
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

function QuickSaleCard({ item }: { item: SalePost }) {
  const price = item.price ? `₦${item.price.toLocaleString()}` : "Free";
  const title = item.title || item.text?.split("\n")[0] || "Item";

  return (
    <div
      className="rounded-[1.25rem] overflow-hidden bg-[var(--c-card)] border border-[var(--c-border)] shadow-sm hover:shadow-[0_16px_40px_rgba(0,0,0,0.16)] transition-shadow duration-200"
    >
      <Link
        href={`/marketplace/${item.id}`}
        className="flex items-center gap-3 p-3"
      >
        <TiltCard className="w-14 h-14 rounded-[1rem] bg-[var(--secondary)] overflow-hidden flex-shrink-0" maxTilt={8} scale={1.08}>
          {item.image_urls?.[0] ? (
            <Image src={item.image_urls[0]} alt={title} fill className="object-cover post-media-image" sizes="56px" />
          ) : null}
        </TiltCard>

        <div className="min-w-0 flex-1">
          <p
            className="font-semibold text-sm text-[var(--c-text)] truncate"
            style={{ fontFamily: FONT_RALEWAY }}
          >
            {title}
          </p>
          <p
            className="font-bold text-sm text-[var(--primary)] mt-1"
            style={{ fontFamily: FONT_RALEWAY }}
          >
            {price}
          </p>
        </div>
      </Link>
    </div>
  );
}

export function HomeRightSidebar() {
  const { profile } = useAuth();
  const [events, setEvents] = useState<EventPost[]>([]);
  const [sales, setSales] = useState<SalePost[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      const [{ data: eventsData }, { data: salesData }] = await Promise.all([
        supabase
          .from("posts")
          .select(
            "id, title, text, event_date, event_location, event_link, image_urls, attendees, user:users!posts_user_id_fkey(name, avatar_url)"
          )
          .eq("category", "Event")
          .order("timestamp", { ascending: false })
          .limit(2),
        supabase
          .from("posts")
          .select("id, title, text, price, image_urls, image_url")
          .eq("category", "For Sale")
          .eq("is_sold", false)
          .gt("price", 0)
          .order("timestamp", { ascending: false })
          .limit(4),
      ]);

      if (eventsData) setEvents(eventsData as any);
      if (salesData) setSales(salesData as any);
      setLoading(false);
    };

    fetchData();
  }, []);

  // Keep "Quick Sales" live: reflect INSERT / UPDATE / DELETE on the posts
  // table without requiring a refresh, mirroring the pattern used by
  // use-posts.tsx for the main feed.
  useEffect(() => {
    const channelId = `quick-sales-${Math.random().toString(36).substring(2, 15)}`;
    const channel = supabase
      .channel(channelId)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "posts" },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const newItem = payload.new as SalePost;
            if (newItem.category !== "For Sale") return;
            if ((newItem as any).is_sold) return;
            if (!newItem.price || newItem.price <= 0) return;
            setSales((prev) => {
              if (prev.some((p) => p.id === newItem.id)) return prev;
              return [newItem, ...prev].slice(0, 4);
            });
          } else if (payload.eventType === "UPDATE") {
            const updated = payload.new as SalePost;
            // Item sold, marked free, or moved out of "For Sale" — drop it.
            if (updated.category !== "For Sale" || (updated as any).is_sold || !updated.price) {
              setSales((prev) => prev.filter((p) => p.id !== updated.id));
              return;
            }
            setSales((prev) => prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)));
          } else if (payload.eventType === "DELETE") {
            setSales((prev) => prev.filter((p) => p.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <aside className="hidden lg:block lg:w-[380px] lg:flex-shrink-0 self-start relative">
      <div className="sticky top-[80px] flex flex-col rounded-[2rem] border border-[var(--c-border)] bg-[var(--c-card)] shadow-[0_24px_80px_rgba(0,0,0,0.22)] overflow-hidden">
      <div className="pointer-events-none absolute -top-10 right-4 h-28 w-28 rounded-full bg-[rgba(32,72,54,0.2)] blur-2xl" />
      <div className="pointer-events-none absolute bottom-2 left-2 h-20 w-20 rounded-full bg-[rgba(24,45,36,0.14)] blur-2xl" />

      <div className="p-4 space-y-6">
        <div>
          <div className="flex items-center justify-between mb-3 px-1">
            <div className="flex items-center gap-2.5 min-w-0">
              <Zap className="w-5 h-5 flex-shrink-0 text-[var(--primary)] fill-[var(--primary)]" />
              <h2
                className="text-[1.25rem] font-bold truncate text-[var(--c-text)]"
                style={{ fontFamily: FONT_RALEWAY }}
              >
                What&apos;s happening
              </h2>
            </div>
            <Link
              href="/events"
              className="flex-shrink-0 text-[0.8rem] font-semibold text-[var(--primary)] hover:underline"
              style={{ fontFamily: FONT_RALEWAY }}
            >
              See All →
            </Link>
          </div>
          <div className="h-px mb-3 bg-gradient-to-r from-[var(--primary)]/25 via-[var(--c-border)] to-transparent" />

          <div className="flex flex-col gap-3">
            {loading ? (
              [1, 2].map((i) => (
                <div key={i} className="h-[180px] rounded-2xl bg-[var(--c-card2)] animate-pulse" />
              ))
            ) : events.length > 0 ? (
              events.map((event) => <EventCard key={event.id} event={event} />)
            ) : (
              <p className="p-4 text-xs text-muted-foreground">No upcoming events.</p>
            )}
          </div>
        </div>

        <div>
          <div className="flex items-center gap-2.5 mb-3 px-1">
            <DollarSign className="w-5 h-5 flex-shrink-0 text-[var(--primary)] fill-[var(--primary)]" />
            <h2
              className="text-[1.25rem] font-bold text-[var(--c-text)]"
              style={{ fontFamily: FONT_RALEWAY }}
            >
              Quick Sales
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {loading ? (
              [1, 2, 3, 4].map((i) => (
                <div key={i} className="h-20 rounded-[1.25rem] bg-[var(--c-card2)] border border-[var(--c-border)] animate-pulse" />
              ))
            ) : sales.length > 0 ? (
              <AnimatePresence initial={false}>
                {sales.map((item) => (
                  <motion.div
                    key={item.id}
                    layout
                    initial={{ opacity: 0, height: 0, y: -12 }}
                    animate={{ opacity: 1, height: "auto", y: 0 }}
                    exit={{ opacity: 0, height: 0, scale: 0.95 }}
                    transition={{ duration: 0.25, ease: "easeOut" }}
                    style={{ overflow: "hidden" }}
                  >
                    <QuickSaleCard item={item} />
                  </motion.div>
                ))}
              </AnimatePresence>
            ) : (
              <p className="p-4 text-xs text-[var(--c-text-muted)] rounded-[1.25rem] bg-[var(--c-card2)]">
                No quick sales yet.
              </p>
            )}
          </div>
        </div>

        {/* Footer — just sits at the natural end of the content */}
        <div className="border-t border-[var(--c-border)] pt-3 pb-1">
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[0.75rem] text-[var(--c-text-muted)]">
            <Link href="/legal/terms" className="hover:underline">Terms</Link>
            <span>·</span>
            <Link href="/legal/privacy" className="hover:underline">Privacy</Link>
          </div>
          <p className="mt-1.5 text-[0.7rem] text-[var(--c-text-muted)]">
            © {new Date().getFullYear()} Yrdly
          </p>
        </div>
      </div>
    </div>
    </aside>
  );
}