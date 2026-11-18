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
import { Phone } from "lucide-react";

interface MarketplaceItemCardProps {
  item: Post;
  onPress?: () => void;
  onMessageSeller?: (item: Post) => void;
  onBuyNow?: (item: Post) => void;
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
  const isPhoneVerified = item.user?.phone_verified;
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
    <GlassCard
      borderRadius={16}
      className="group flex w-full flex-col justify-between overflow-hidden border border-border bg-card transition-colors hover:border-primary/50"
    >
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
                className="object-cover motion-safe:transition-transform motion-safe:duration-300 motion-safe:group-hover:scale-105"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-emerald-950/30">
                <ShoppingBag
                  className="h-10 w-10 text-primary"
                  aria-hidden="true"
                />
              </div>
            )}
          </div>

          {/* Content stays readable in a two-column phone grid. */}
          <div className="space-y-2 p-3 sm:p-4">
            <p className="break-words text-lg font-bold leading-6 tracking-tight text-foreground sm:text-xl">
              {getListingPriceLabel(item.price, formatPrice)}
            </p>
            <h2 className="line-clamp-2 min-h-10 break-words text-sm font-semibold leading-5 text-foreground transition-colors group-hover:text-primary">
              {item.title || item.text || "Item"}
            </h2>
            {!!locationText && (
              <p className="flex min-w-0 items-start gap-1 text-xs leading-5 text-muted-foreground">
                <MapPin
                  className="mt-0.5 h-3.5 w-3.5 shrink-0"
                  aria-hidden="true"
                />
                <span className="line-clamp-2 break-words">{locationText}</span>
              </p>
            )}
            <div className="flex min-w-0 items-center gap-1.5">
              <div className="relative flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10">
                {sellerAvatar ? (
                  <Image
                    src={sellerAvatar}
                    alt=""
                    fill
                    className="object-cover"
                  />
                ) : (
                  <span
                    className="text-xs font-semibold text-primary"
                    aria-hidden="true"
                  >
                    {sellerName.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
              <span className="min-w-0 truncate text-xs text-muted-foreground">
                {sellerName}
              </span>
            </div>
            {isPhoneVerified === true && (
              <p className="flex flex-wrap items-center gap-1 text-xs font-medium leading-5 text-primary">
                <Phone className="h-3 w-3 shrink-0" aria-hidden="true" />
                Phone verified
              </p>
            )}
          </div>
        </Link>
        {item.condition && (
          <span className="pointer-events-none absolute left-2 top-2 max-w-[calc(100%-4.5rem)] rounded-lg bg-background px-2 py-1 text-xs font-semibold leading-5 text-foreground shadow-sm">
            {item.condition}
          </span>
        )}
        {/* Bookmark Button */}
        <button
          aria-label={saved ? "Unsave item" : "Save item"}
          aria-pressed={saved}
          aria-busy={saving}
          disabled={saving}
          onClick={toggleSaved}
          className="absolute right-2 top-2 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-background text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
        >
          <Bookmark
            className={`h-4 w-4 ${saved ? "fill-red-500 text-red-500" : "text-foreground"}`}
          />
        </button>
      </div>

      {/* Action Footer */}
      {!isOwner && !item.is_sold && (
        <div className="px-3 pb-3 sm:px-4 sm:pb-4">
          <button
            onClick={handleMessage}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary/10 py-2 text-sm font-semibold text-primary hover:bg-primary/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            <span>Chat seller</span>
          </button>
        </div>
      )}
    </GlassCard>
  );
}
