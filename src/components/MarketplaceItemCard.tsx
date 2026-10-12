"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  Heart,
  MessageCircle,
  ShoppingBag,
  MapPin,
} from "lucide-react";
import type { Post } from "@/types";
import { formatPrice } from "@/lib/utils";
import { useAuth } from "@/hooks/use-supabase-auth";
import { supabase } from "@/lib/supabase";
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
    (Date.now() - new Date(item.timestamp || item.created_at || "").getTime()) / 3600000;
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
  const isOwner = user?.id === item.user_id;
  const [saved, setSaved] = useState(user ? (item.liked_by || []).includes(user.id) : false);

  useEffect(() => {
    setSaved(user ? (item.liked_by || []).includes(user.id) : false);
  }, [item.liked_by, user]);

  const parsedUrls = Array.isArray(item.image_urls)
    ? item.image_urls
    : typeof item.image_urls === "string"
    ? JSON.parse(item.image_urls || "[]")
    : [];
  const imageUrl =
    parsedUrls.length > 0 ? parsedUrls[0] : item.image_url || item.video_thumbnail_url;
  const sellerName = item.user?.name || item.author_name || "Seller";
  const sellerAvatar = item.user?.avatar_url || item.author_image;
  const isVerifiedSeller = item.user?.verified_seller;
  const badge = getBadge(item);
  const locationText = item.lga && item.state ? `${item.lga}, ${item.state}` : item.state || "";

  const toggleSaved = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) return;
    const previousSaved = saved;
    setSaved(!previousSaved);

    try {
      const { data, error } = await supabase.rpc("toggle_post_like", {
        p_post_id: item.id,
        p_user_id: user.id,
      });
      if (error) throw error;
      if (data) {
        setSaved(data.is_liked);
      }
    } catch (err) {
      console.error("Failed to toggle like", err);
      setSaved(previousSaved);
    }
  };

  const handleCardClick = () => {
    if (onPress) {
      onPress();
    } else {
      router.push(`/marketplace/${item.id}`);
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
    <GlassCard
      onClick={handleCardClick}
      className="group cursor-pointer overflow-hidden rounded-2xl transition-all duration-200 hover:shadow-md w-full flex flex-col justify-between"
    >
      <div>
        {/* Product Image Header */}
        <div className="relative aspect-square w-full overflow-hidden bg-muted">
          {imageUrl ? (
            <Image
              src={imageUrl}
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

          {/* Bookmark Button */}
          <button
            aria-label={saved ? "Unsave item" : "Save item"}
            aria-pressed={saved}
            onClick={toggleSaved}
            className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-background/70 backdrop-blur-md transition-all hover:bg-background/90 active:scale-95 shadow-sm"
          >
            <Heart className={`h-4 w-4 ${saved ? "fill-red-500 text-red-500" : "text-foreground"}`} />
          </button>

        </div>

        {/* Content Body */}
        <div className="p-4 space-y-2.5">
          <h4 className="line-clamp-2 min-h-10 text-sm font-bold text-foreground group-hover:text-primary transition-colors">
            {item.title || item.text || "Item"}
          </h4>

          <p className="break-words text-base sm:text-lg font-bold tracking-tight text-foreground">{item.price === 0 ? "Free" : formatPrice(item.price)}</p>
          {/* Seller information */}
          <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
            <div className="relative h-6 w-6 shrink-0 rounded-full overflow-hidden bg-primary/20 flex items-center justify-center">
              {sellerAvatar ? (
                <Image src={sellerAvatar} alt={sellerName} fill className="object-cover" />
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
            {(item as any).item_condition && <span>{(item as any).item_condition}</span>}
            {badge && <span>{badge}</span>}
          </div>
          {!!locationText && (
            <div className="flex items-center gap-1 text-[0.6875rem] text-muted-foreground">
              <MapPin className="h-3 w-3 flex-shrink-0 text-primary" />
              <span className="truncate">{locationText}</span>
            </div>
          )}
        </div>
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
