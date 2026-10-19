"use client";

import React, { useState, useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { useToast } from "@/hooks/use-toast";
import {
  getListingCover,
  getListingPriceLabel,
} from "@/lib/marketplace/card-display";
import { useRouter } from "next/navigation";
import { Bookmark, MessageCircle, ShoppingBag, MapPin } from "lucide-react";
import type { Post } from "@/types/index";
import { formatPrice } from "@/lib/shared/utils";
import { useAuth } from "@/hooks/use-supabase-auth";
import { supabase } from "@/lib/supabase/supabase";
import { GlassCard } from "@/components/GlassCard";
import { VerifiedBadge } from "@/components/VerifiedBadge";

interface MarketplaceItemCardProps {
  item: Post;
  onPress?: () => void;
  onMessageSeller?: (item: Post) => void;
  onBuyNow?: (item: Post) => void;
}

type BadgeType = "Just Listed" | "Popular" | "Price Reduced" | "Free";

function getBadge(item: Post): BadgeType | null {
  if (item.price === 0) return "Free";
  const ageHours =
    (Date.now() - new Date(item.timestamp || item.created_at || "").getTime()) /
    3600000;
  if (ageHours < 6) return "Just Listed";
  if ((item as any).view_count > 50) return "Popular";
  if ((item as any).price_reduced) return "Price Reduced";
  return null;
}

export function MarketplaceItemCard({
  item,
  onPress,
  onMessageSeller,
  onBuyNow,
}: MarketplaceItemCardProps) {
  const { user } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [failedImage, setFailedImage] = useState<string>();
  const isOwner = user?.id === item.user_id;
  const [saved, setSaved] = useState(false);
  const savePending = useRef(false);
  const saveRevision = useRef(0);

  useEffect(() => {
    let active = true;
    const currentRevision = ++saveRevision.current;
    setSaved(false);

    const handleBookmark = (event: Event) => {
      const detail = (event as CustomEvent<{ postId: string; saved: boolean }>)
        .detail;
      if (detail?.postId === item.id) {
        saveRevision.current++;
        setSaved(detail.saved);
      }
    };
    window.addEventListener("yrdly:bookmark", handleBookmark);

    if (user) {
      void supabase
        .from("post_bookmarks")
        .select("id")
        .eq("post_id", item.id)
        .eq("user_id", user.id)
        .maybeSingle()
        .then(({ data, error }) => {
          if (active && !error && currentRevision === saveRevision.current)
            setSaved(!!data);
        });
    }

    return () => {
      active = false;
      window.removeEventListener("yrdly:bookmark", handleBookmark);
    };
  }, [item.id, user?.id]);

  const imageUrl = getListingCover(item);
  const sellerName = item.user?.name || item.author_name || "Seller";
  const sellerAvatar = item.user?.avatar_url || item.author_image;
  const isVerifiedSeller = item.user?.verified_seller;
  const badge = getBadge(item);
  const locationText = [item.lga, item.state].filter(Boolean).join(", ");

  const toggleSaved = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) {
      toast({
        title: "Sign in to save listings",
        description: "Sign in to keep this listing in your saved items.",
      });
      router.push("/login");
      return;
    }
    if (savePending.current) return;
    savePending.current = true;
    setSaving(true);
    saveRevision.current++;
    const nextSaved = !saved;
    setSaved(nextSaved);

    try {
      const result = nextSaved
        ? await supabase
            .from("post_bookmarks")
            .insert({ post_id: item.id, user_id: user.id })
        : await supabase
            .from("post_bookmarks")
            .delete()
            .match({ post_id: item.id, user_id: user.id });
      if (result.error && !(nextSaved && result.error.code === "23505"))
        throw result.error;
      window.dispatchEvent(
        new CustomEvent("yrdly:bookmark", {
          detail: { postId: item.id, saved: nextSaved },
        }),
      );
    } catch (error) {
      console.error("Failed to toggle saved item", error);
      setSaved(!nextSaved);
      toast({
        variant: "destructive",
        title: "Could not update saved item",
        description: "Please try again.",
      });
    } finally {
      savePending.current = false;
      setSaving(false);
    }
  };

  const handleDetailClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (
      onPress &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey &&
      event.button === 0
    ) {
      event.preventDefault();
      onPress();
    }
  };

  const handleMessage = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onMessageSeller) {
      onMessageSeller(item);
    } else {
      router.push(`/messages?seller=${item.user_id}&item=${item.id}`);
    }
  };

  return (
    <GlassCard className="group overflow-hidden rounded-2xl transition-all duration-200 hover:shadow-md w-full flex flex-col justify-between">
      <div className="relative">
        <Link
          href={`/marketplace/${item.id}`}
          onClick={handleDetailClick}
          aria-label={`View ${item.title || item.text || "listing"}`}
          className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
        >
          {/* Product Image Header */}
          <div className="relative aspect-square w-full overflow-hidden bg-muted">
            {imageUrl && failedImage !== imageUrl ? (
              <Image
                src={imageUrl}
                onError={() => setFailedImage(imageUrl)}
                alt={item.title || item.text || "Marketplace Item"}
                fill
                sizes="(max-width: 640px) 50vw, 280px"
                className="object-cover transition-transform duration-300 group-hover:scale-105"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-emerald-950/30">
                <ShoppingBag className="h-10 w-10 text-primary/40" />
              </div>
            )}
          </div>

          {/* Content Body */}
          <div className="p-4 space-y-2.5">
            <h4 className="line-clamp-2 min-h-10 text-sm font-bold text-foreground group-hover:text-primary transition-colors">
              {item.title || item.text || "Item"}
            </h4>

            <p className="break-words text-base sm:text-lg font-bold tracking-tight text-foreground">
              {getListingPriceLabel(item.price, formatPrice)}
            </p>
            {/* Seller information */}
            <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
              <div className="relative h-6 w-6 shrink-0 rounded-full overflow-hidden bg-primary/20 flex items-center justify-center">
                {sellerAvatar ? (
                  <Image
                    src={sellerAvatar}
                    alt={sellerName}
                    fill
                    className="object-cover"
                  />
                ) : (
                  <span className="text-[0.625rem] font-bold text-primary">
                    {sellerName.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
              <span className="text-[0.6875rem] font-semibold text-foreground min-w-0 truncate">
                {sellerName}
              </span>
              {isVerifiedSeller && <VerifiedBadge size={14} />}
            </div>

            <div className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
              {item.condition && <span>{item.condition}</span>}
              {badge && <span>{badge}</span>}
            </div>
            {!!locationText && (
              <div className="flex items-center gap-1 text-[0.6875rem] text-muted-foreground">
                <MapPin className="h-3 w-3 flex-shrink-0 text-primary" />
                <span className="truncate">{locationText}</span>
              </div>
            )}
          </div>
        </Link>
        {/* Bookmark Button */}
        <button
          aria-label={saved ? "Unsave item" : "Save item"}
          aria-pressed={saved}
          aria-busy={saving}
          disabled={saving}
          onClick={toggleSaved}
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-background/70 backdrop-blur-md transition-all hover:bg-background/90 active:scale-95 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
        >
          <Bookmark
            className={`h-4 w-4 ${saved ? "fill-red-500 text-red-500" : "text-foreground"}`}
          />
        </button>
      </div>

      {/* Action Footer */}
      {!isOwner && !item.is_sold && (
        <div className="p-3.5 pt-0">
          <button
            onClick={handleMessage}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary py-2 text-xs font-semibold transition-all active:scale-95"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            <span>Chat Seller</span>
          </button>
        </div>
      )}
    </GlassCard>
  );
}
