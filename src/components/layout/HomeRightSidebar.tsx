"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { supabase } from "@/lib/supabase";
import { MapPin } from "lucide-react";
import type { Post } from "@/types";
import { useAuth } from "@/hooks/use-supabase-auth";

const CARD_BG = "var(--c-card)";
const FONT_RALEWAY = "Inter, sans-serif";
const FONT_PACIFICO = "var(--font-jersey25)";
const GREEN = "hsl(var(--primary))";

type EventPost = Post & { user?: { name?: string; avatar_url?: string } };
type SalePost = Post & { user?: { name?: string; avatar_url?: string } };

function formatDate(d: string | null | undefined) {
  if (!d) return "";
  try {
    return new Date(d).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

function getLocation(loc: unknown) {
  if (!loc || typeof loc !== "object") return "";
  const o = loc as Record<string, unknown>;
  return typeof o.address === "string" ? o.address : "";
}

const AVATAR_COLORS = ["#D75656", "#5CD756", "#565CD7", "#D7569D"];

function InterestedBubbles({ count }: { count: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex -space-x-1">
        {AVATAR_COLORS.slice(0, 4).map((c, i) => (
          <div
            key={i}
            className="w-4 h-4 rounded-full border border-[var(--c-card)]"
            style={{ background: c }}
          />
        ))}
      </div>
      {count > 0 && (
        <span
          className="font-sans font-light text-[0.4375rem] text-foreground"
          style={{ fontFamily: FONT_RALEWAY }}
        >
          {count} are interested
        </span>
      )}
    </div>
  );
}

function EventCard({ event }: { event: EventPost }) {
  const attendeeCount = (event as any).attendees?.length || 0;

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

  return (
    <Link href={safeLink} className="block p-3 hover:bg-accent transition-colors">
      <p
        className="text-[0.9375rem] leading-[26px] text-foreground mb-1"
        style={{ fontFamily: FONT_PACIFICO }}
      >
        In your area
      </p>

      <div className="rounded-[4px] overflow-hidden" style={{ background: "var(--c-bg)" }}>
        <div className="flex items-center gap-2 p-2">
          <div className="w-7 h-7 rounded-[3px] bg-background/10 overflow-hidden flex-shrink-0">
            {event.image_urls?.[0] && (
              <Image
                src={event.image_urls[0]}
                alt=""
                width={28}
                height={28}
                className="w-full h-full object-cover"
              />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p
              className="font-sans italic font-medium text-[0.6875rem] text-foreground truncate"
              style={{ fontFamily: FONT_RALEWAY }}
            >
              {event.title || event.text?.split("\n")[0] || "Event"}
            </p>
            <p
              className="font-sans font-normal text-[0.375rem] text-muted-foreground"
              style={{ fontFamily: FONT_RALEWAY }}
            >
              {formatDate(event.event_date ?? null)}
            </p>
          </div>

          <MapPin className="w-4 h-4 text-foreground flex-shrink-0" />
        </div>

        {(getLocation(event.event_location) || event.text) && (
          <p
            className="font-sans font-light text-[0.5625rem] text-foreground px-2 pb-2 leading-[11px]"
            style={{ fontFamily: FONT_RALEWAY }}
          >
            {getLocation(event.event_location) || event.text?.slice(0, 80)}
          </p>
        )}

        <div className="mx-2" style={{ borderTop: "0.5px solid #BBBBBB" }} />

        <div className="flex items-center justify-between px-2 py-2">
          <InterestedBubbles count={attendeeCount} />
          <button
            className="px-2 py-1 text-foreground font-sans font-light text-[0.5625rem] rounded-[11.5px]"
            style={{ background: GREEN, fontFamily: FONT_RALEWAY }}
            onClick={(e) => e.preventDefault()}
          >
            I&apos;m Interested
          </button>
        </div>
      </div>
    </Link>
  );
}

function QuickSaleCard({ item }: { item: SalePost }) {
  const price = item.price ? `₦${item.price.toLocaleString()}` : "Free";

  return (
    <Link
      href={`/marketplace/${item.id}`}
      className="flex gap-2 p-2 rounded-lg hover:bg-accent transition-colors"
    >
      <div className="w-12 h-12 rounded-lg bg-background overflow-hidden flex-shrink-0">
        {item.image_urls?.[0] && (
          <Image
            src={item.image_urls[0]}
            alt=""
            width={48}
            height={48}
            className="w-full h-full object-cover"
          />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p
          className="font-sans font-semibold text-[0.75rem] text-foreground truncate"
          style={{ fontFamily: FONT_RALEWAY }}
        >
          {item.title || item.text?.split("\n")[0] || "Item"}
        </p>
        <p
          className="font-sans font-bold text-[0.875rem] text-primary"
          style={{ fontFamily: FONT_RALEWAY }}
        >
          {price}
        </p>
      </div>
    </Link>
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
          .limit(4),
        supabase
          .from("posts")
          .select("id, title, text, price, image_urls, image_url")
          .eq("category", "For Sale")
          .eq("is_sold", false)
          .gt("price", 0)
          .order("timestamp", { ascending: false })
          .limit(6),
      ]);

      if (eventsData) setEvents(eventsData as any);
      if (salesData) setSales(salesData as any);
      setLoading(false);
    };

    fetchData();
  }, []);

  return (
    <aside className="hidden lg:flex lg:flex-col lg:w-[380px] lg:flex-shrink-0 lg:overflow-y-auto gap-4 pt-1">
      <div className="flex gap-3 items-start">
        <div className="flex-1 flex flex-col gap-4 min-w-0">
          <div>
            <div className="flex items-center justify-between mb-2 px-1">
              <h2
                className="text-[1.125rem] leading-8 text-foreground"
                style={{ fontFamily: FONT_PACIFICO }}
              >
                Latest Events
              </h2>
              <Link
                href="/events"
                className="font-sans font-medium text-[0.75rem] text-[#1976D2] hover:underline"
                style={{ fontFamily: FONT_RALEWAY }}
              >
                See all
              </Link>
            </div>

            <div className="rounded-[5px] overflow-hidden" style={{ background: CARD_BG }}>
              {loading ? (
                <div className="p-3 space-y-3">
                  {[1, 2].map((i) => (
                    <div key={i} className="h-[120px] rounded bg-background animate-pulse" />
                  ))}
                </div>
              ) : events.length > 0 ? (
                events.slice(0, 2).map((event) => <EventCard key={event.id} event={event} />)
              ) : (
                <p className="p-4 font-sans text-xs text-muted-foreground">No upcoming events.</p>
              )}
            </div>
          </div>

          <div>
            <h2
              className="text-[1.125rem] leading-8 text-foreground mb-2 px-1"
              style={{ fontFamily: FONT_PACIFICO }}
            >
              Quick Sales
            </h2>

            <div className="rounded-[5px] overflow-hidden" style={{ background: CARD_BG }}>
              {loading ? (
                <div className="p-3 space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-14 rounded bg-background animate-pulse" />
                  ))}
                </div>
              ) : sales.length > 0 ? (
                sales.map((item) => <QuickSaleCard key={item.id} item={item} />)
              ) : (
                <p className="p-4 font-sans text-xs text-muted-foreground">No quick sales yet.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
