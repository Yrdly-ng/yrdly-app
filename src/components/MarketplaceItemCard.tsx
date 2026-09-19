"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  Heart,
  MessageCircle,
  ShoppingBag,
  MapPin,
  Tag,
  Sparkles,
  TrendingDown,
  Gift,
  Star,
  CheckCircle2,
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

const BADGE_COLORS: Record<BadgeType, { bg: string; text: string }> = {
  "Just Listed": { bg: "rgba(130,219,126,0.2)", text: "#82DB7E" },
  Popular: { bg: "rgba(245,158,11,0.2)", text: "#F59E0B" },
  "Price Reduced": { bg: "rgba(139,92,246,0.2)", text: "#8B5CF6" },
  Free: { bg: "rgba(34,197,94,0.2)", text: "#22c55e" },
};

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
      className="group cursor-pointer overflow-hidden rounded-2xl transition-all duration-200 hover:-translate-y-1 hover:shadow-xl w-full flex flex-col justify-between"
    >
      <div>
        {/* Product Image Header */}
        <div className="relative aspect-square w-full overflow-hidden bg-muted">
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt={item.title || item.text || "Marketplace Item"}
              fill
              className="object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-emerald-950/30">
              <ShoppingBag className="h-10 w-10 text-primary/40" />
            </div>
          )}

          {/* Seller Avatar Badge Overlay */}
          <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-background/80 backdrop-blur-md p-1 pr-2.5 shadow-md border border-border/50">
            <div className="relative h-6 w-6 rounded-full overflow-hidden bg-primary/20 flex items-center justify-center">
              {sellerAvatar ? (
                <Image src={sellerAvatar} alt={sellerName} fill className="object-cover" />
              ) : (
                <span className="text-[0.625rem] font-bold text-primary">
                  {sellerName.charAt(0).toUpperCase()}
                </span>
              )}
            </div>
            <span className="text-[0.6875rem] font-semibold text-foreground max-w-[80px] truncate">
              {sellerName}
            </span>
            {isVerifiedSeller && <VerifiedBadge size={14} />}
          </div>

          {/* Bookmark Button */}
          <button
            onClick={toggleSaved}
            className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-background/70 backdrop-blur-md transition-all hover:bg-background/90 active:scale-95 shadow-sm"
          >
            <Heart className={`h-4 w-4 ${saved ? "fill-red-500 text-red-500" : "text-foreground"}`} />
          </button>

          {/* Badge Tag */}
          {badge && (
            <div
              className="absolute bottom-2.5 left-3 rounded-full px-2.5 py-0.5 text-[0.625rem] font-bold backdrop-blur-md shadow-sm"
              style={{ backgroundColor: BADGE_COLORS[badge].bg, color: BADGE_COLORS[badge].text }}
            >
              {badge}
            </div>
          )}

          {/* Price Tag Overlay */}
          <div className="absolute bottom-2.5 right-3 rounded-full bg-primary px-3 py-1 text-xs font-extrabold text-primary-foreground shadow-lg">
            {item.price === 0 ? "Free" : formatPrice(item.price)}
          </div>
        </div>

        {/* Content Body */}
        <div className="p-3.5 space-y-2">
          <h4 className="line-clamp-1 text-sm font-bold text-foreground group-hover:text-primary transition-colors">
            {item.title || item.text || "Item"}
          </h4>

          {(item as any).item_condition && (
            <div className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-0.5 text-[0.625rem] font-medium text-muted-foreground">
              <Tag className="h-3 w-3" />
              <span>{(item as any).item_condition}</span>
            </div>
          )}

          {!!locationText && (
            <div className="flex items-center gap-1 text-[0.6875rem] text-muted-foreground">
              <MapPin className="h-3 w-3 flex-shrink-0 text-primary" />
              <span className="truncate">{locationText}</span>
            </div>
          )}
        </div>
      </div>

      {/* Action Footer */}
      {!isOwner && (
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
