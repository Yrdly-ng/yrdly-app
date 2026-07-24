"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ArrowLeft, Star, MapPin, Clock, Phone, MessageCircle, Share2, Heart, ShoppingCart } from "lucide-react";
import type { Business, CatalogItem } from "@/types";
import { useState } from "react";
import { useAuth } from "@/hooks/use-supabase-auth";
import Image from "next/image";
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

  const handleCall = () => {
    if (business.phone) {
      window.open(`tel:${business.phone}`, '_self');
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
      } catch (error) {
      }
    } else {
      // Fallback to clipboard
      navigator.clipboard.writeText(window.location.href);
    }
  };

  const nextImage = () => {
    if (item.images.length > 1) {
      setCurrentImageIndex((prev) => (prev + 1) % item.images.length);
    }
  };

  const prevImage = () => {
    if (item.images.length > 1) {
      setCurrentImageIndex((prev) => (prev - 1 + item.images.length) % item.images.length);
    }
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header with item images */}
      <div className="relative">
        <div className="relative h-64 bg-gradient-to-br from-primary/20 to-accent/20 overflow-hidden">
          <Image
            src={item.images[currentImageIndex] || "/placeholder.svg"}
            alt={item.title}
            width={400}
            height={256}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
          
          {/* Image navigation arrows */}
          {item.images.length > 1 && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="absolute left-4 top-1/2 transform -translate-y-1/2 bg-background/80 backdrop-blur-sm hover:bg-background"
                onClick={prevImage}
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <Button
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
            variant="ghost" 
            size="icon" 
            className="bg-background/80 backdrop-blur-sm hover:bg-background"
            onClick={handleShare}
          >
            <Share2 className="w-5 h-5" />
          </Button>
          <Button variant="ghost" size="icon" className="bg-background/80 backdrop-blur-sm hover:bg-background">
            <Heart className="w-5 h-5" />
          </Button>
        </div>

        {/* Image indicators */}
        {item.images.length > 1 && (
          <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex gap-2">
            {item.images.map((_, index) => (
              <button
                key={index}
                className={`w-2 h-2 rounded-full ${
                  index === currentImageIndex ? 'bg-primary' : 'bg-primary/50'
                }`}
                onClick={() => setCurrentImageIndex(index)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Item info */}
      <div className="p-4 space-y-4">
        <div className="space-y-2">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-foreground">{item.title}</h1>
              <Badge variant="outline" className="mt-1">
                {item.category}
              </Badge>
            </div>
            <div className="text-right">
              <p className="text-3xl font-bold text-primary">₦{item.price.toLocaleString()}</p>
              {!item.in_stock && (
                <Badge variant="destructive" className="mt-1">Out of Stock</Badge>
              )}
            </div>
          </div>

          <p className="text-muted-foreground">{item.description}</p>
        </div>

        {/* Business info */}
        <Card className="p-4 bg-muted/30">
          <div className="flex items-center gap-3">
            <Avatar className="w-12 h-12">
              <AvatarImage src={business.logo || business.owner_avatar || "/placeholder.svg"} />
              <AvatarFallback>{business.name[0]}</AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <h3 className="font-semibold text-foreground">{business.name}</h3>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                <span>{business.rating?.toFixed(1) || "0.0"}</span>
                <span>•</span>
                <span>{business.review_count || 0} reviews</span>
              </div>
            </div>
          </div>
        </Card>

        {/* Action buttons */}
        <div className="flex gap-2">
          {user?.id !== business.owner_id ? (
            item.in_stock ? (
              <div className="flex-1">
                <BuyButton 
                  itemId={item.id}
                  itemTitle={item.title}
                  itemImageUrl={item.images[0]}
                  price={item.price}
                  condition="New"
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
            className={`border-primary text-primary hover:bg-primary hover:text-primary-foreground bg-transparent ${user?.id === business.owner_id ? 'flex-1' : ''}`}
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
              onClick={() => window.open(`/businesses/${business.id}`, '_blank')}
            >
              <MapPin className="w-4 h-4 mr-2" />
              Visit Store
            </Button>
          </div>
        )}
      </div>

      {/* Item details */}
      <div className="p-4 pt-0 space-y-4">
        <div>
          <h3 className="font-semibold text-foreground mb-2">Item Details</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Category:</span>
              <span className="text-foreground">{item.category}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Availability:</span>
              <span className={`${item.in_stock ? 'text-green-600' : 'text-red-600'}`}>
                {item.in_stock ? 'In Stock' : 'Out of Stock'}
              </span>
            </div>

          </div>
        </div>

        <div>
          <h3 className="font-semibold text-foreground mb-2">Business Contact</h3>
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
                {typeof business.location === 'string' 
                  ? business.location 
                  : business.location?.address 
                    ? business.location.address
                    : (business.state || business.lga)
                      ? [business.lga, business.state].filter(Boolean).join(", ")
                      : 'Location not specified'
                }
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
