import "server-only";
import type { Metadata } from "next";
import { cache } from "react";
import { supabaseAdmin } from "../supabase/supabase-admin";

const ORIGIN = "https://app.yrdly.ng";
type Kind = "posts" | "marketplace" | "events" | "businesses";
const clean = (text: unknown, limit = 220) =>
  typeof text === "string"
    ? text.replace(/\s+/g, " ").trim().slice(0, limit)
    : "";
const imageUrl = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.pathname.includes("/object/sign/") &&
      !url.searchParams.has("token")
      ? url.href
      : null;
  } catch {
    return null;
  }
};
const money = (value: unknown) =>
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);

// React cache deduplicates work within one render only. The route stays dynamic
// so a visibility or moderation change takes effect on the next preview request.
export const publicLinkMetadata = cache(
  async (kind: Kind, id: string): Promise<Metadata> => {
    const canonical = `${ORIGIN}/${kind}/${encodeURIComponent(id)}`;
    const unavailable: Metadata = {
      title: "Content unavailable | Yrdly",
      description: "Connect with your neighbourhood on Yrdly.",
      robots: { index: false, follow: false },
    };
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) return unavailable;
    let title = "",
      description = "",
      image: string | null = null;
    if (kind === "posts" || kind === "marketplace") {
      let query = supabaseAdmin
        .from("posts")
        .select(
          "id,title,text,description,author_name,image_urls,image_url,video_thumbnail_url,price,condition,lga,state,category",
        )
        .eq("id", id)
        .eq("visibility", "public")
        .eq("moderation_status", "approved");
      if (kind === "marketplace")
        query = query.in("category", ["For Sale", "Giveaway"]);
      const { data: post, error } = await query.maybeSingle();
      if (error || !post) return unavailable;
      const place = [post.lga, post.state].filter(Boolean).join(", ");
      title =
        kind === "marketplace"
          ? `${clean(post.title || post.text, 90)} · ${post.category === "Giveaway" ? "Free" : money(post.price)}`
          : `${clean(post.author_name || "A neighbour", 80)} on Yrdly`;
      description =
        kind === "marketplace"
          ? [post.condition, place, clean(post.description || post.text)]
              .filter(Boolean)
              .join(" · ")
          : clean(post.text || post.title);
      image =
        imageUrl(post.image_urls?.[0]) ||
        imageUrl(post.image_url) ||
        imageUrl(post.video_thumbnail_url);
    } else if (kind === "events") {
      const { data: event, error } = await supabaseAdmin
        .from("events")
        .select(
          "title,description,cover_image_url,image_urls,start_time,timezone,location_address,lga,state",
        )
        .eq("id", id)
        .eq("status", "PUBLISHED")
        .eq("visibility", "public")
        .eq("moderation_status", "approved")
        .eq("is_archived", false)
        .maybeSingle();
      if (error || !event) return unavailable;
      title = clean(event.title, 110);
      let when = "";
      try {
        when = new Intl.DateTimeFormat("en-NG", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: event.timezone || "Africa/Lagos",
        }).format(new Date(event.start_time));
      } catch {}
      description = [
        when,
        event.location_address ||
          [event.lga, event.state].filter(Boolean).join(", "),
        clean(event.description),
      ]
        .filter(Boolean)
        .join(" · ");
      image =
        imageUrl(event.cover_image_url) || imageUrl(event.image_urls?.[0]);
    } else {
      const { data: business, error } = await supabaseAdmin
        .from("businesses")
        .select(
          "name,description,category,logo_url,logo,cover_image,image_urls,lga,state",
        )
        .eq("id", id)
        .eq("is_active", true)
        .eq("moderation_status", "approved")
        .maybeSingle();
      if (error || !business) return unavailable;
      title = clean(business.name, 110);
      description = [
        business.category,
        [business.lga, business.state].filter(Boolean).join(", "),
        clean(business.description),
      ]
        .filter(Boolean)
        .join(" · ");
      image =
        imageUrl(business.logo_url) ||
        imageUrl(business.logo) ||
        imageUrl(business.cover_image) ||
        imageUrl(business.image_urls?.[0]);
    }
    image ||= `${ORIGIN}/icon-512x512.png`;
    description = clean(description, 320);
    return {
      title,
      description,
      alternates: { canonical },
      openGraph: {
        title,
        description,
        url: canonical,
        siteName: "Yrdly",
        type: kind === "posts" ? "article" : "website",
        images: [{ url: image, alt: title }],
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
        images: [image],
      },
    };
  },
);
