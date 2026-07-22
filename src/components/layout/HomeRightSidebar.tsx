"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { supabase } from "@/lib/supabase";
import { MapPin } from "lucide-react";
import type { Post } from "@/types";
import { useAuth } from "@/hooks/use-supabase-auth";

const FONT_RALEWAY = "Inter, sans-serif";

type EventPost = Post & { user?: { name?: string; avatar_url?: string } };
type SalePost = Post & { user?: { name?: string; avatar_url?: string } };

function formatDate(d: string | null | undefined) {
  if (!d) return "";
  try {
    return new Date(d).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
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

  return (
    <Link
      href={safeLink}
      className="relative block w-full h-[180px] rounded-2xl overflow-hidden group"
    >
      {event.image_urls?.[0] ? (
        <Image
          src={event.image_urls[0]}
          alt={title}
          fill
          className="object-cover group-hover:scale-105 transition-transform duration-300"
          sizes="380px"
        />
      ) : (
        <div className="absolute inset-0 bg-gray-300" />
      )}

      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />

      <div className="absolute bottom-0 left-0 right-0 p-4 flex items-end justify-between gap-2">
        <div className="min-w-0">
          <p
            className="text-white font-extrabold text-xl leading-tight truncate"
            style={{ fontFamily: FONT_RALEWAY }}
          >
            {title}
          </p>
          <p className="text-white/90 text-[13px] font-medium" style={{ fontFamily: FONT_RALEWAY }}>
            {formatDate(event.event_date ?? null)}
          </p>
          {location && (
            <p className="flex items-center gap-1 text-white/90 text-[12px] mt-0.5" style={{ fontFamily: FONT_RALEWAY }}>
              <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">{location}</span>
            </p>
          )}
        </div>

        <button
          className="flex-shrink-0 px-4 py-2 rounded-full text-white text-[13px] font-semibold bg-blue-600 hover:bg-blue-700 transition-colors"
          style={{ fontFamily: FONT_RALEWAY }}
          onClick={(e) => e.preventDefault()}
        >
          Interested
        </button>
      </div>
    </Link>
  );
}

function QuickSaleCard({ item }: { item: SalePost }) {
  const price = item.price ? `₦${item.price.toLocaleString()}` : "Free";
  const title = item.title || item.text?.split("\n")[0] || "Item";

  return (
    <Link
      href={`/marketplace/${item.id}`}
      className="flex items-center gap-3 p-3 rounded-2xl bg-white hover:shadow-md transition-shadow"
    >
      <div className="w-14 h-14 rounded-xl bg-gray-100 overflow-hidden flex-shrink-0 relative">
        {item.image_urls?.[0] ? (
          <Image src={item.image_urls[0]} alt={title} fill className="object-cover" sizes="56px" />
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        <p
          className="font-semibold text-[13px] text-gray-900 truncate"
          style={{ fontFamily: FONT_RALEWAY }}
        >
          {title}
        </p>
        <p
          className="font-bold text-[14px] text-primary"
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

  return (
    <aside className="hidden lg:flex lg:flex-col lg:w-[380px] lg:flex-shrink-0 lg:overflow-y-auto gap-6 pt-1 pb-6">
      <div>
        <h2
          className="text-[1.25rem] font-bold text-gray-900 mb-3 px-1"
          style={{ fontFamily: FONT_RALEWAY }}
        >
          Upcoming Events
        </h2>

        <div className="flex flex-col gap-3">
          {loading ? (
            [1, 2].map((i) => (
              <div key={i} className="h-[180px] rounded-2xl bg-white animate-pulse" />
            ))
          ) : events.length > 0 ? (
            events.map((event) => <EventCard key={event.id} event={event} />)
          ) : (
            <p className="p-4 text-xs text-muted-foreground">No upcoming events.</p>
          )}
        </div>
      </div>

      <div>
        <h2
          className="text-[1.25rem] font-bold text-gray-900 mb-3 px-1"
          style={{ fontFamily: FONT_RALEWAY }}
        >
          Quick Sales
        </h2>

        <div className="grid grid-cols-2 gap-3">
          {loading ? (
            [1, 2, 3, 4].map((i) => (
              <div key={i} className="h-20 rounded-2xl bg-white animate-pulse" />
            ))
          ) : sales.length > 0 ? (
            sales.map((item) => <QuickSaleCard key={item.id} item={item} />)
          ) : (
            <p className="p-4 text-xs text-muted-foreground">No quick sales yet.</p>
          )}
        </div>
      </div>
    </aside>
  );
}
