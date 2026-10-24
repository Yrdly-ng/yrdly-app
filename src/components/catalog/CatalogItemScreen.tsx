"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  ArrowLeft,
  Star,
  MapPin,
  Clock,
  Phone,
  MessageCircle,
  Share2,
  Heart,
  ShoppingCart,
  BadgeCheck,
} from "lucide-react";
import type { Business, CatalogItem } from "@/types/index";
import { useState } from "react";
import { useAuth } from "@/hooks/use-supabase-auth";
import Image from "next/image";
import Link from "next/link";
import {
  getBusinessRating,
  getBusinessLocation,
  getBusinessLogo,
  isCatalogItemAvailable,
} from "@/lib/businesses/presentation";
import { BuyButton } from "@/components/escrow/BuyButton";

interface CatalogItemScreenProps {
  business: Business;
  item: CatalogItem;
  onBack: () => void;
  onMessageOwner: (item?: CatalogItem) => void;
}

export function CatalogItemScreen({
  business,
  item,
  onBack,
  onMessageOwner,
}: CatalogItemScreenProps) {
  const { user } = useAuth();
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const images = item.images || [];
  const available = isCatalogItemAvailable(item);
  const rating = getBusinessRating(business.rating, business.review_count);

  const handleCall = () => {
    if (business.phone) {
      window.open(`tel:${business.phone}`, "_self");
    }
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: item.title,
          text: item.description,
          url: window.location.href,
        });
      } catch (error) {}
    } else {
      // Fallback to clipboard
      navigator.clipboard.writeText(window.location.href);
    }
  };

  const nextImage = () => {
    if (images.length > 1) {
      setCurrentImageIndex((prev) => (prev + 1) % images.length);
    }
  };

  const prevImage = () => {
    if (images.length > 1) {
      setCurrentImageIndex(
        (prev) => (prev - 1 + images.length) % images.length,
      );
    }
  };

  return (
    <div className="mx-auto flex min-h-full max-w-5xl flex-col bg-background pb-20 font-yrdly-body sm:px-6 sm:py-6">
      {/* Header with item images */}
      <div className="relative">
        <div className="relative h-80 sm:h-[460px] rounded-b-3xl sm:rounded-3xl bg-muted overflow-hidden">
          <Image
            src={images[currentImageIndex] || "/placeholder.svg"}
            alt={item.title}
            width={400}
            height={256}
            className="w-full h-full object-contain"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />

          {/* Image navigation arrows */}
          {images.length > 1 && (
            <>
              <Button
                aria-label="Previous image"
                variant="ghost"
                size="icon"
                className="absolute left-4 top-1/2 transform -translate-y-1/2 bg-background/80 backdrop-blur-sm hover:bg-background"
                onClick={prevImage}
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <Button
                aria-label="Next image"
                variant="ghost"
                size="icon"
                className="absolute right-4 top-1/2 transform -translate-y-1/2 bg-background/80 backdrop-blur-sm hover:bg-background"
                onClick={nextImage}
              >
                <ArrowLeft className="w-5 h-5 rotate-180" />
              </Button>
            </>
          )}
        </div>

        {/* Back button */}
        <Button
          aria-label="Back"
          variant="ghost"
          size="icon"
          className="absolute top-4 left-4 bg-background/80 backdrop-blur-sm hover:bg-background"
          onClick={onBack}
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>

        {/* Action buttons */}
        <div className="absolute top-4 right-4 flex gap-2">
          <Button
            aria-label="Share"
            variant="ghost"
            size="icon"
            className="bg-background/80 backdrop-blur-sm hover:bg-background"
            onClick={handleShare}
          >
            <Share2 className="w-5 h-5" />
          </Button>
        </div>

        {/* Image indicators */}
        {images.length > 1 && (
          <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex gap-2">
            {images.map((_, index) => (
              <button
                key={index}
                aria-label={`View product photo ${index + 1}`}
                aria-pressed={index === currentImageIndex}
                className={`w-2 h-2 rounded-full ${
                  index === currentImageIndex ? "bg-primary" : "bg-primary/50"
                }`}
                onClick={() => setCurrentImageIndex(index)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Item info */}
      <div className="px-5 py-7 space-y-6 sm:px-7">
        <div className="space-y-2">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h1 className="font-yrdly-display text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
                {item.title}
              </h1>
              <Badge variant="outline" className="mt-1">
                {item.category}
              </Badge>
            </div>
            <div className="text-right">
              <p className="font-yrdly-display text-3xl font-bold text-foreground">
                ₦{item.price.toLocaleString()}
              </p>
              {!available && (
                <Badge variant="destructive" className="mt-1">
                  Out of Stock
                </Badge>
              )}
            </div>
          </div>

          <p className="text-muted-foreground">{item.description}</p>
        </div>

        {/* Business info */}
        <Card className="rounded-3xl border-border bg-card p-5">
          <div className="flex items-center gap-3">
            <Avatar className="w-12 h-12">
              <AvatarImage
                src={
                  getBusinessLogo(business) || "/placeholder.svg"
                }
              />
              <AvatarFallback>{business.name[0]}</AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <h3 className="font-semibold text-foreground flex items-center gap-1">
                {business.name}
                {((business as any).verified_seller ||
                  (business as any).is_verified) && (
                  <BadgeCheck className="w-4 h-4 text-[#82DB7E] fill-[#82DB7E]/20 shrink-0" />
                )}
              </h3>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                {rating && (
                  <span className="flex items-center gap-1">
                    <Star size={14} className="text-amber-500" />
                    {rating}
                  </span>
                )}
                <Link
                  href={`/businesses/${business.id}`}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  Visit business →
                </Link>
              </div>
            </div>
          </div>
        </Card>

        {/* Action buttons */}
        <div className="flex gap-2">
          {user?.id !== business.owner_id ? (
            available ? (
              <div className="flex-1">
                <BuyButton
                  itemId={item.id}
                  itemTitle={item.title}
                  itemImageUrl={images[0]}
                  price={item.price}
                  condition={(item as any).condition || undefined}
                  sellerId={business.owner_id}
                  sellerName={business.name}
                  itemType="catalog_item"
                />
              </div>
            ) : (
              <Button
                className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
                disabled
              >
                Item Unavailable
              </Button>
            )
          ) : null}
          <Button
            variant="outline"
            className={`border-primary text-primary hover:bg-primary hover:text-primary-foreground bg-transparent ${user?.id === business.owner_id ? "flex-1" : ""}`}
            onClick={handleCall}
            disabled={!business.phone}
          >
            <Phone className="w-4 h-4 mr-2" />
            Call
          </Button>
        </div>

        {/* Additional actions */}
        {user?.id !== business.owner_id && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => onMessageOwner(item)}
            >
              <MessageCircle className="w-4 h-4 mr-2" />
              Message About Item
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={() =>
                window.open(`/businesses/${business.id}`, "_blank")
              }
            >
              <MapPin className="w-4 h-4 mr-2" />
              Visit Store
            </Button>
          </div>
        )}
      </div>

      {/* Item details */}
      <div className="mx-5 space-y-6 rounded-3xl border border-border bg-card p-6 sm:mx-7">
        <div>
          <h3 className="font-yrdly-display text-xl font-semibold text-foreground mb-3">
            Item Details
          </h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Category:</span>
              <span className="text-foreground">{item.category}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Availability:</span>
              <span
                className={`${available ? "text-green-600" : "text-red-600"}`}
              >
                {available ? "In Stock" : "Out of Stock"}
              </span>
            </div>
          </div>
        </div>

        <div>
          <h3 className="font-yrdly-display text-xl font-semibold text-foreground mb-3">
            Business Contact
          </h3>
          <div className="space-y-2 text-sm">
            {business.phone && (
              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-muted-foreground" />
                <span className="text-foreground">{business.phone}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-muted-foreground" />
              <span className="text-foreground">
                {typeof business.location === "string"
                  ? business.location
                  : business.location?.address
                    ? business.location.address
                    : business.state || business.lga
                      ? [business.lga, business.state]
                          .filter(Boolean)
                          .join(", ")
                      : "Location not specified"}
              </span>
            </div>
            {business.hours && (
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <span className="text-foreground">{business.hours}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
