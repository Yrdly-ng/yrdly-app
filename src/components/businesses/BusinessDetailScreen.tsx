"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  ArrowLeft,
  Star,
  MapPin,
  Clock,
  Phone,
  Mail,
  MessageCircle,
  Share2,
  Heart,
  MoreVertical,
  Edit,
  Trash2,
  Plus,
  Package,
  BadgeCheck,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import type { Business, CatalogItem } from "@/types/index";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase/supabase";
import { useAuth } from "@/hooks/use-supabase-auth";
import Image from "next/image";
import { shortenAddress } from "@/lib/shared/utils";
import { CreateCatalogItemDialog } from "@/components/catalog/CreateCatalogItemDialog";
import { CreateBusinessDialog } from "@/components/businesses/CreateBusinessDialog";
import { CatalogService } from "@/lib/catalog/catalog-service";
import { ReviewService } from "@/lib/reviews/review-service";
import { WriteBusinessReviewDialog } from "@/components/reviews/WriteBusinessReviewDialog";
import { useToast } from "@/hooks/use-toast";
import { useRouter } from "next/navigation";
import { useServiceOfferings } from "@/hooks/use-bookings";
import {
  getBusinessModeLabel,
  getBusinessCatalogItems,
  getCatalogItemImage,
  shouldShowBusinessCatalog,
} from "@/lib/businesses/presentation";
import { GetDirectionsLink } from "@/components/location/GetDirectionsLink";

interface BusinessDetailScreenProps {
  business: Business;
  onBack: () => void;
  onBusinessUpdated: () => void;
  onBusinessDeleted: () => void;
  onMessageOwner: (business: Business, item?: CatalogItem) => void;
  onViewCatalogItem: (item: CatalogItem) => void;
}

export function BusinessDetailScreen({
  business,
  onBack,
  onBusinessUpdated,
  onBusinessDeleted,
  onMessageOwner,
  onViewCatalogItem,
}: BusinessDetailScreenProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState(
    business.mode === "service" ? "services" : "catalog",
  );
  const {
    offerings,
    loading: servicesLoading,
    error: servicesError,
    refresh: refreshServices,
  } = useServiceOfferings(business.id);
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [reviews, setReviews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [reviewsError, setReviewsError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [showOutOfStock, setShowOutOfStock] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);
  const [isEditBusinessOpen, setIsEditBusinessOpen] = useState(false);
  const [isDeleteBusinessOpen, setIsDeleteBusinessOpen] = useState(false);
  const [isDeletingBusiness, setIsDeletingBusiness] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);
  const [favoriteLoading, setFavoriteLoading] = useState(false);
  const [hasReviewed, setHasReviewed] = useState(false);
  const { user } = useAuth();
  const { toast } = useToast();
  const isOwner = user?.id === business.owner_id;
  const reviewCount = reviews.length;
  const averageRating =
    reviewCount > 0
      ? reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / reviewCount
      : 0;

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tab") === "reviews") {
      setActiveTab("reviews");
    } else if (business.mode === "service" || business.mode === "both") {
      setActiveTab("services");
    }
  }, [business.mode, catalogItems.length, catalogError]);

  useEffect(() => {
    const fetchCatalogItems = async () => {
      setCatalogError("");
      try {
        const { data, error } = await supabase
          .from("catalog_items")
          .select("*")
          .eq("business_id", business.id)
          .order("created_at", { ascending: false });

        if (error) {
          setCatalogError("We couldn’t load the products. Please try again.");
        } else {
          setCatalogItems(data || []);
        }
      } catch (error) {
        setCatalogError("We couldn’t load the products. Please try again.");
      }
    };

    const fetchReviews = async () => {
      setReviewsError("");
      try {
        const { data, error } = await supabase
          .from("business_reviews")
          .select(
            `
            *,
            users:public_profiles!business_reviews_user_id_fkey(
              name,
              avatar_url
            )
          `,
          )
          .eq("business_id", business.id)
          .order("created_at", { ascending: false });

        if (error) {
          setReviewsError("We couldn’t load the reviews. Please try again.");
        } else {
          setReviews(data || []);
        }
      } catch (error) {
        setReviewsError("We couldn’t load the reviews. Please try again.");
      } finally {
        setLoading(false);
      }
    };

    const fetchFavoriteStatus = async () => {
      if (!user) {
        setIsFavorited(false);
        return;
      }
      try {
        const { data, error } = await supabase
          .from("business_favorites")
          .select("id")
          .eq("business_id", business.id)
          .eq("user_id", user.id)
          .maybeSingle();

        if (!error) setIsFavorited(!!data);
      } catch (error) {
        setIsFavorited(false);
      }
    };

    const fetchReviewEligibility = async () => {
      if (!user || user.id === business.owner_id) {
        setHasReviewed(false);
        return;
      }
      try {
        const reviewed = await ReviewService.hasUserReviewedBusiness(
          user.id,
          business.id,
        );
        setHasReviewed(reviewed);
      } catch (error) {
        console.error("Could not verify business review eligibility:", error);
        setHasReviewed(true);
      }
    };

    fetchCatalogItems();
    fetchReviews();
    fetchFavoriteStatus();
    fetchReviewEligibility();
  }, [business.id, business.owner_id, user, loadAttempt]);

  const handleToggleFavorite = async () => {
    if (!user) {
      toast({
        title: "Sign in required",
        description: "Log in to save businesses to your favorites.",
        variant: "destructive",
      });
      return;
    }
    setFavoriteLoading(true);
    try {
      if (isFavorited) {
        const { error } = await supabase
          .from("business_favorites")
          .delete()
          .eq("business_id", business.id)
          .eq("user_id", user.id);
        if (error) throw error;
        setIsFavorited(false);
      } else {
        const { error } = await supabase
          .from("business_favorites")
          .insert({ business_id: business.id, user_id: user.id });
        if (error) throw error;
        setIsFavorited(true);
      }
    } catch (error) {
      console.error("Error toggling favorite:", error);
      toast({
        title: "Error",
        description: "Failed to update favorites. Please try again.",
        variant: "destructive",
      });
    } finally {
      setFavoriteLoading(false);
    }
  };

  const handleReviewSuccess = async () => {
    setHasReviewed(true);
    const { data } = await supabase
      .from("business_reviews")
      .select(
        `*, users:public_profiles!business_reviews_user_id_fkey(name, avatar_url)`,
      )
      .eq("business_id", business.id)
      .order("created_at", { ascending: false });
    setReviews(data || []);
  };

  const handleCall = () => {
    if (business.phone) {
      window.open(`tel:${business.phone}`, "_self");
    }
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: business.name,
          text: business.description,
          url: window.location.href,
        });
      } catch (error) {}
    } else {
      // Fallback to clipboard
      navigator.clipboard.writeText(window.location.href);
    }
  };

  const refreshCatalog = async () => {
    try {
      const { data, error } = await supabase
        .from("catalog_items")
        .select("*")
        .eq("business_id", business.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setCatalogItems(data || []);
    } catch (error) {
      console.error("Error refreshing catalog:", error);
    }
  };

  const handleToggleStock = async (itemId: string, currentStock: boolean) => {
    try {
      await CatalogService.toggleStockStatus(
        itemId,
        business.id,
        !currentStock,
      );
      await refreshCatalog();
      toast({
        title: "Success",
        description: `Item marked as ${!currentStock ? "in stock" : "out of stock"}`,
      });
    } catch (error) {
      console.error("Error toggling stock:", error);
      toast({
        title: "Error",
        description: "Failed to update stock status",
        variant: "destructive",
      });
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    try {
      await CatalogService.deleteCatalogItem(itemId, business.id);
      await refreshCatalog();
      setItemToDelete(null);
      toast({
        title: "Success",
        description: "Item deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting item:", error);
      toast({
        title: "Error",
        description: "Failed to delete item",
        variant: "destructive",
      });
    }
  };

  const handleDeleteBusiness = async () => {
    if (!user || !isOwner) return;
    setIsDeletingBusiness(true);
    try {
      const { data, error } = await supabase
        .from("businesses")
        .update({ is_active: false })
        .eq("id", business.id)
        .eq("owner_id", user.id)
        .select("id")
        .maybeSingle();

      if (error) throw error;
      if (!data)
        throw new Error(
          "Business not found or you do not have permission to delete it.",
        );

      toast({
        title: "Business deleted",
        description: "This business is no longer visible to customers.",
      });
      setIsDeleteBusinessOpen(false);
      onBusinessDeleted();
    } catch (error) {
      console.error("Error deleting business:", error);
      toast({
        title: "Error",
        description: "Failed to delete business.",
        variant: "destructive",
      });
    } finally {
      setIsDeletingBusiness(false);
    }
  };

  const filteredCatalogItems = getBusinessCatalogItems(
    catalogItems,
    isOwner,
    showOutOfStock,
  );
  const showCatalogTab = shouldShowBusinessCatalog(
    business.mode,
    catalogItems.length,
    Boolean(catalogError),
  );

  return (
    <div className="mx-auto flex min-h-full max-w-6xl flex-col bg-background font-yrdly-body text-foreground pb-16 sm:px-6 sm:py-6">
      {/* Header with cover image */}
      <div className="relative">
        <div className="relative h-56 sm:h-80 rounded-b-3xl sm:rounded-3xl bg-muted overflow-hidden">
          <Image
            src={
              business.cover_image ||
              (business as any).cover_url ||
              (business as any).banner_url ||
              (business as any).banner ||
              business.image_urls?.[0] ||
              "/placeholder.svg"
            }
            alt={business.name}
            width={400}
            height={192}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
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
          <Button
            aria-label="Save to favorites"
            variant="ghost"
            size="icon"
            className="bg-background/80 backdrop-blur-sm hover:bg-background"
            onClick={handleToggleFavorite}
            disabled={favoriteLoading}
          >
            <Heart
              className={`w-5 h-5 ${isFavorited ? "fill-red-500 text-red-500" : ""}`}
            />
          </Button>
        </div>

        {/* Business logo */}
        <div className="absolute -bottom-12 left-4">
          <div className="w-24 h-24 rounded-2xl bg-background border-4 border-background yrdly-shadow-lg overflow-hidden">
            <Image
              src={business.logo || business.owner_avatar || "/placeholder.svg"}
              alt={business.name}
              width={96}
              height={96}
              className="w-full h-full object-cover"
            />
          </div>
        </div>
      </div>

      {/* Business info */}
      <div className="px-5 pb-7 pt-16 space-y-5 sm:px-7">
        <div className="space-y-2">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h1 className="font-yrdly-display text-3xl sm:text-4xl font-bold tracking-tight text-foreground flex items-center gap-2">
                {business.name}
                {business.verified_seller && (
                  <BadgeCheck
                    aria-label="Verified business"
                    className="w-6 h-6 text-primary shrink-0"
                  />
                )}
              </h1>
              <Badge variant="outline" className="mt-1">
                {business.category}
              </Badge>
              <Badge variant="secondary" className="ml-2">
                {getBusinessModeLabel(business.mode)}
              </Badge>
            </div>
          </div>

          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-1">
              <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
              <span className="font-semibold">
                {reviewCount ? averageRating.toFixed(1) : "No reviews yet"}
              </span>
              {reviewCount > 0 && (
                <span className="text-sm text-muted-foreground">
                  ({reviewCount} review{reviewCount === 1 ? "" : "s"})
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 text-muted-foreground">
              <Clock className="w-4 h-4" />
              <span className="text-sm">{business.hours}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 text-muted-foreground">
            <MapPin className="w-4 h-4 text-primary flex-shrink-0" />
            <span
              className="text-sm"
              title={
                typeof business.location === "string"
                  ? business.location
                  : business.location?.address || "Location not specified"
              }
            >
              {typeof business.location === "string"
                ? shortenAddress(business.location, 60)
                : business.location?.address
                  ? shortenAddress(business.location.address, 60)
                  : business.state || business.lga
                    ? [business.lga, business.state].filter(Boolean).join(", ")
                    : "Location not specified"}
            </span>
          </div>
          <GetDirectionsLink
            target={{ type: "business", id: business.id }}
            className="mt-3"
          />
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          {isOwner && (
            <div className="flex flex-wrap gap-2 w-full rounded-3xl border border-border bg-card p-4">
              <Button
                variant="outline"
                onClick={() => setIsEditBusinessOpen(true)}
              >
                <Edit className="w-4 h-4 mr-2" /> Edit Business
              </Button>
              <Button
                variant="destructive"
                onClick={() => setIsDeleteBusinessOpen(true)}
              >
                <Trash2 className="w-4 h-4 mr-2" /> Delete Business
              </Button>
              {(business.mode === "service" || business.mode === "both") && (
                <Button
                  variant="outline"
                  onClick={() =>
                    router.push(`/businesses/${business.id}/manage-services`)
                  }
                >
                  Manage Services
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() =>
                  router.push(`/businesses/${business.id}/manage-availability`)
                }
              >
                Manage Availability
              </Button>
              {(business.mode === "service" || business.mode === "both") && (
                <Button
                  onClick={() =>
                    router.push(`/businesses/${business.id}/bookings`)
                  }
                >
                  Booking Requests
                </Button>
              )}
            </div>
          )}
          {user?.id !== business.owner_id && (
            <Button
              className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={() => onMessageOwner(business)}
            >
              <MessageCircle className="w-4 h-4 mr-2" />
              Message
            </Button>
          )}
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
      </div>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex-1 flex flex-col"
      >
        <TabsList className="h-auto w-full justify-start gap-2 overflow-x-auto rounded-2xl border border-border bg-card p-2">
          {showCatalogTab && (
            <TabsTrigger
              value="catalog"
              className="min-h-11 rounded-xl px-5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
            >
              Products
            </TabsTrigger>
          )}
          {(business.mode === "service" || business.mode === "both") && (
            <TabsTrigger
              value="services"
              className="min-h-11 rounded-xl px-5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
            >
              Services
            </TabsTrigger>
          )}
          <TabsTrigger
            value="about"
            className="min-h-11 rounded-xl px-5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            About
          </TabsTrigger>
          <TabsTrigger
            value="reviews"
            className="min-h-11 rounded-xl px-5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            Reviews
          </TabsTrigger>
        </TabsList>

        <div className="flex-1">
          {showCatalogTab && (
            <TabsContent value="catalog" className="p-4 mt-0">
              {/* Owner Controls */}
              {isOwner && (
                <div className="mb-4 space-y-3">
                  <CreateCatalogItemDialog
                    businessId={business.id}
                    onSuccess={refreshCatalog}
                  >
                    <Button className="w-full">
                      <Plus className="mr-2 h-4 w-4" />
                      Add Catalog Item
                    </Button>
                  </CreateCatalogItemDialog>

                  {catalogItems.length > 0 && (
                    <div className="flex items-center justify-between p-3 border rounded-lg">
                      <span className="text-sm font-medium">
                        Show Out of Stock Items
                      </span>
                      <Switch
                        checked={showOutOfStock}
                        onCheckedChange={setShowOutOfStock}
                      />
                    </div>
                  )}
                </div>
              )}

              {catalogError ? (
                <div
                  role="alert"
                  className="rounded-2xl border border-destructive/30 p-5"
                >
                  {catalogError}
                  <Button
                    variant="outline"
                    className="ml-3"
                    onClick={() => setLoadAttempt((value) => value + 1)}
                  >
                    Try again
                  </Button>
                </div>
              ) : loading ? (
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                  {[...Array(4)].map((_, i) => (
                    <Card key={i} className="overflow-hidden">
                      <div className="aspect-square bg-muted animate-pulse" />
                      <div className="p-3 space-y-2">
                        <div className="h-4 bg-muted rounded animate-pulse" />
                        <div className="h-6 bg-muted rounded animate-pulse" />
                      </div>
                    </Card>
                  ))}
                </div>
              ) : filteredCatalogItems.length > 0 ? (
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredCatalogItems.map((item) => (
                    <Card
                      key={item.id}
                      className="overflow-hidden rounded-3xl border-border transition-colors hover:border-primary/50 relative"
                    >
                      <div
                        className="relative aspect-square bg-muted cursor-pointer"
                        onClick={() => !isOwner && onViewCatalogItem(item)}
                      >
                        <Image
                          src={getCatalogItemImage(item.images)}
                          alt={item.title}
                          width={200}
                          height={200}
                          className="w-full h-full object-cover"
                        />
                        {!item.in_stock && (
                          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                            <Badge variant="secondary">Out of Stock</Badge>
                          </div>
                        )}
                      </div>
                      <div className="p-3 space-y-1">
                        <div className="flex items-start justify-between gap-2">
                          <div
                            className="flex-1 cursor-pointer"
                            onClick={() => !isOwner && onViewCatalogItem(item)}
                          >
                            <h4 className="font-semibold text-sm text-foreground truncate">
                              {item.title}
                            </h4>
                            <p className="text-lg font-bold text-primary">
                              ₦{item.price.toLocaleString()}
                            </p>
                          </div>

                          {/* Owner Controls */}
                          {isOwner && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  aria-label="More options"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                >
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <CreateCatalogItemDialog
                                  businessId={business.id}
                                  itemToEdit={item}
                                  onSuccess={refreshCatalog}
                                >
                                  <DropdownMenuItem
                                    onSelect={(e) => e.preventDefault()}
                                  >
                                    <Edit className="mr-2 h-4 w-4" />
                                    Edit
                                  </DropdownMenuItem>
                                </CreateCatalogItemDialog>
                                <DropdownMenuItem
                                  onClick={() => setItemToDelete(item.id)}
                                >
                                  <Trash2 className="mr-2 h-4 w-4" />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>

                        {/* Stock Toggle for Owner */}
                        {isOwner && (
                          <div className="flex items-center justify-between pt-2 border-t">
                            <span className="text-xs text-muted-foreground">
                              In Stock
                            </span>
                            <Switch
                              checked={item.in_stock}
                              onCheckedChange={() =>
                                handleToggleStock(item.id, item.in_stock)
                              }
                              className="scale-75"
                            />
                          </div>
                        )}
                      </div>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <Package className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground mb-4">
                    {isOwner
                      ? "No catalog items yet. Add your first item to start selling!"
                      : "No catalog items available yet."}
                  </p>
                  {isOwner && (
                    <CreateCatalogItemDialog
                      businessId={business.id}
                      onSuccess={refreshCatalog}
                    >
                      <Button>
                        <Plus className="mr-2 h-4 w-4" />
                        Add First Item
                      </Button>
                    </CreateCatalogItemDialog>
                  )}
                </div>
              )}

              {/* Delete Confirmation Dialog */}
              <AlertDialog
                open={!!itemToDelete}
                onOpenChange={() => setItemToDelete(null)}
              >
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete Catalog Item?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This action cannot be undone. This will permanently delete
                      this catalog item.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() =>
                        itemToDelete && handleDeleteItem(itemToDelete)
                      }
                      className="bg-destructive hover:bg-destructive/90"
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </TabsContent>
          )}

          {(business.mode === "service" || business.mode === "both") && (
            <TabsContent value="services" className="p-4 mt-0 space-y-3">
              {servicesError ? (
                <div
                  role="alert"
                  className="rounded-2xl border border-destructive/30 p-5"
                >
                  {servicesError}
                  <Button
                    variant="outline"
                    className="ml-3"
                    onClick={() => void refreshServices()}
                  >
                    Try again
                  </Button>
                </div>
              ) : servicesLoading ? (
                <div className="py-12 text-center text-muted-foreground">
                  Loading services...
                </div>
              ) : offerings.length ? (
                offerings.map((service) => (
                  <Card
                    key={service.id}
                    className="rounded-3xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <h3 className="font-semibold text-foreground">
                        {service.name}
                      </h3>
                      {service.description && (
                        <p className="text-sm text-muted-foreground mt-1">
                          {service.description}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-3 mt-2 text-sm">
                        <span className="text-muted-foreground">
                          {service.duration_minutes} min
                        </span>
                        {service.price != null && (
                          <span className="font-semibold text-primary">
                            {service.price_is_from ? "From " : ""}₦
                            {Number(service.price).toLocaleString()}
                          </span>
                        )}
                      </div>
                    </div>
                    {isOwner ? (
                      <Button
                        variant="outline"
                        onClick={() =>
                          router.push(
                            `/businesses/${business.id}/manage-services`,
                          )
                        }
                      >
                        Edit services
                      </Button>
                    ) : (
                      <Button
                        onClick={() =>
                          router.push(
                            `/bookings/create?businessId=${encodeURIComponent(business.id)}&serviceId=${encodeURIComponent(service.id)}`,
                          )
                        }
                      >
                        Request booking
                      </Button>
                    )}
                  </Card>
                ))
              ) : (
                <div className="text-center py-12">
                  <p className="text-muted-foreground mb-4">
                    {isOwner
                      ? "Add a service so customers can book you."
                      : "No services are listed yet."}
                  </p>
                  {isOwner && (
                    <Button
                      onClick={() =>
                        router.push(
                          `/businesses/${business.id}/manage-services`,
                        )
                      }
                    >
                      Add your first service
                    </Button>
                  )}
                </div>
              )}
            </TabsContent>
          )}

          <TabsContent value="about" className="p-4 mt-0 space-y-4">
            <div>
              <h3 className="font-semibold text-foreground mb-2">About</h3>
              <p className="text-muted-foreground">{business.description}</p>
            </div>

            <div>
              <h3 className="font-semibold text-foreground mb-2">
                Contact Information
              </h3>
              <div className="space-y-2">
                {business.email && (
                  <div className="flex items-center gap-2">
                    <Mail className="w-4 h-4 text-muted-foreground" />
                    <span className="text-muted-foreground">
                      {business.email}
                    </span>
                  </div>
                )}
                {business.phone && (
                  <div className="flex items-center gap-2">
                    <Phone className="w-4 h-4 text-muted-foreground" />
                    <span className="text-muted-foreground">
                      {business.phone}
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-muted-foreground" />
                  <span
                    className="text-muted-foreground"
                    title={
                      typeof business.location === "string"
                        ? business.location
                        : business.location?.address || "Location not specified"
                    }
                  >
                    {typeof business.location === "string"
                      ? shortenAddress(business.location, 50)
                      : business.location?.address
                        ? shortenAddress(business.location.address, 50)
                        : business.state || business.lga
                          ? [business.lga, business.state]
                              .filter(Boolean)
                              .join(", ")
                          : "Location not specified"}
                  </span>
                </div>
                {business.website && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">
                      {business.website}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div>
              <h3 className="font-semibold text-foreground mb-2">
                Business Owner
              </h3>
              <div className="flex items-center gap-3">
                <Avatar className="w-12 h-12">
                  <AvatarImage
                    src={business.owner_avatar || "/placeholder.svg"}
                  />
                  <AvatarFallback>
                    {business.owner_name?.[0] || "O"}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-semibold text-foreground">
                    {business.owner_name}
                  </p>
                  <p className="text-sm text-muted-foreground">Owner</p>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="reviews" className="p-4 mt-0 space-y-4">
            {!isOwner && user && !hasReviewed && (
              <WriteBusinessReviewDialog
                businessId={business.id}
                businessName={business.name}
                onSuccess={handleReviewSuccess}
              >
                <Button className="w-full">
                  <Star className="w-4 h-4 mr-2" />
                  Write a Review
                </Button>
              </WriteBusinessReviewDialog>
            )}
            {reviewsError ? (
              <div
                role="alert"
                className="rounded-2xl border border-destructive/30 p-5"
              >
                {reviewsError}
                <Button
                  variant="outline"
                  className="ml-3"
                  onClick={() => setLoadAttempt((value) => value + 1)}
                >
                  Try again
                </Button>
              </div>
            ) : loading ? (
              <div className="space-y-4">
                {[...Array(3)].map((_, i) => (
                  <Card key={i} className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 bg-muted rounded-full animate-pulse" />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 bg-muted rounded animate-pulse w-1/3" />
                        <div className="h-3 bg-muted rounded animate-pulse w-1/4" />
                        <div className="h-4 bg-muted rounded animate-pulse" />
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            ) : reviews.length > 0 ? (
              reviews.map((review) => (
                <Card key={review.id} className="p-4">
                  <div className="flex items-start gap-3">
                    <Avatar className="w-10 h-10">
                      <AvatarImage
                        src={review.users?.avatar_url || "/placeholder.svg"}
                      />
                      <AvatarFallback>
                        {review.users?.name?.[0] || "U"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="font-semibold text-foreground">
                          {review.users?.name || "Anonymous"}
                        </p>
                        <div className="flex items-center gap-1">
                          <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                          <span className="text-sm">{review.rating}</span>
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {review.comment}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(review.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </Card>
              ))
            ) : (
              <div className="text-center py-8">
                <p className="text-muted-foreground">
                  {isOwner
                    ? "Customer reviews will appear here."
                    : "No reviews yet. Be the first to review this business!"}
                </p>
              </div>
            )}
          </TabsContent>
        </div>
      </Tabs>

      <CreateBusinessDialog
        open={isEditBusinessOpen}
        onOpenChange={setIsEditBusinessOpen}
        businessToEdit={business}
        onCreated={onBusinessUpdated}
      />

      <AlertDialog
        open={isDeleteBusinessOpen}
        onOpenChange={setIsDeleteBusinessOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {business.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The business will be removed from customer listings. Its bookings,
              reviews, and business records will be preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingBusiness}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteBusiness}
              disabled={isDeletingBusiness}
            >
              {isDeletingBusiness ? "Deleting..." : "Delete Business"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
