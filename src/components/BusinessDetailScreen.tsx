"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ArrowLeft, Star, MapPin, Clock, Phone, Mail, MessageCircle, Share2, Heart, MoreVertical, Edit, Trash2, Plus, Package, BadgeCheck } from "lucide-react";
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
import type { Business, CatalogItem } from "@/types";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-supabase-auth";
import Image from "next/image";
import { shortenAddress } from "@/lib/utils";
import { CreateCatalogItemDialog } from "@/components/CreateCatalogItemDialog";
import { CatalogService } from "@/lib/catalog-service";
import { useToast } from "@/hooks/use-toast";

interface BusinessDetailScreenProps {
  business: Business;
  onBack: () => void;
  onMessageOwner: (business: Business, item?: CatalogItem) => void;
  onViewCatalogItem: (item: CatalogItem) => void;
}

export function BusinessDetailScreen({
  business,
  onBack,
  onMessageOwner,
  onViewCatalogItem,
}: BusinessDetailScreenProps) {
  const [activeTab, setActiveTab] = useState("catalog");
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [reviews, setReviews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showOutOfStock, setShowOutOfStock] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);
  const { user } = useAuth();
  const { toast } = useToast();
  const isOwner = user?.id === business.owner_id;

  useEffect(() => {
    const fetchCatalogItems = async () => {
      try {
        const { data, error } = await supabase
          .from('catalog_items')
          .select('*')
          .eq('business_id', business.id)
          .order('created_at', { ascending: false });

        if (error) {
          setCatalogItems([]);
        } else {
          setCatalogItems(data || []);
        }
      } catch (error) {
        setCatalogItems([]);
      }
    };

    const fetchReviews = async () => {
      try {
        const { data, error } = await supabase
          .from('business_reviews')
          .select(`
            *,
            users!business_reviews_user_id_fkey(
              name,
              avatar_url
            )
          `)
          .eq('business_id', business.id)
          .order('created_at', { ascending: false });

        if (error) {
          setReviews([]);
        } else {
          setReviews(data || []);
        }
      } catch (error) {
        setReviews([]);
      } finally {
        setLoading(false);
      }
    };

    fetchCatalogItems();
    fetchReviews();
  }, [business.id]);

  const handleCall = () => {
    if (business.phone) {
      window.open(`tel:${business.phone}`, '_self');
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
      } catch (error) {
      }
    } else {
      // Fallback to clipboard
      navigator.clipboard.writeText(window.location.href);
    }
  };

  const refreshCatalog = async () => {
    try {
      const { data, error } = await supabase
        .from('catalog_items')
        .select('*')
        .eq('business_id', business.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setCatalogItems(data || []);
    } catch (error) {
      console.error('Error refreshing catalog:', error);
    }
  };

  const handleToggleStock = async (itemId: string, currentStock: boolean) => {
    try {
      await CatalogService.toggleStockStatus(itemId, business.id, !currentStock);
      await refreshCatalog();
      toast({
        title: "Success",
        description: `Item marked as ${!currentStock ? 'in stock' : 'out of stock'}`,
      });
    } catch (error) {
      console.error('Error toggling stock:', error);
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
      console.error('Error deleting item:', error);
      toast({
        title: "Error",
        description: "Failed to delete item",
        variant: "destructive",
      });
    }
  };

  const filteredCatalogItems = showOutOfStock
    ? catalogItems
    : catalogItems.filter(item => item.in_stock);

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header with cover image */}
      <div className="relative">
        <div className="relative h-48 bg-gradient-to-br from-primary/20 to-accent/20 overflow-hidden">
          <Image
            src={business.cover_image || business.image_urls?.[0] || "/placeholder.svg"}
            alt={business.name}
            width={400}
            height={192}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
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
      <div className="p-4 pt-16 space-y-4">
        <div className="space-y-2">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-foreground flex items-center gap-1.5">
                {business.name}
                <BadgeCheck className="w-6 h-6 text-yellow-500 fill-yellow-500/10" />
              </h1>
              <Badge variant="outline" className="mt-1">
                {business.category}
              </Badge>
            </div>
          </div>

          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-1">
              <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
              <span className="font-semibold">{business.rating?.toFixed(1) || "0.0"}</span>
              <span className="text-sm text-muted-foreground">({business.review_count || 0} reviews)</span>
            </div>
            <div className="flex items-center gap-1 text-muted-foreground">
              <Clock className="w-4 h-4" />
              <span className="text-sm">{business.hours}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 text-muted-foreground">
            <MapPin className="w-4 h-4 text-primary flex-shrink-0" />
            <span className="text-sm" title={typeof business.location === 'string' ? business.location : business.location?.address || 'Location not specified'}>
              {typeof business.location === 'string' 
                ? shortenAddress(business.location, 60)
                : business.location?.address 
                  ? shortenAddress(business.location.address, 60)
                  : (business.state || business.lga)
                    ? [business.lga, business.state].filter(Boolean).join(", ")
                    : 'Location not specified'
              }
            </span>
            {business.distance && (
              <>
                <span className="text-sm">•</span>
                <span className="text-sm">{business.distance}</span>
              </>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
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
            className={`border-primary text-primary hover:bg-primary hover:text-primary-foreground bg-transparent ${user?.id === business.owner_id ? 'flex-1' : ''}`}
            onClick={handleCall}
            disabled={!business.phone}
          >
            <Phone className="w-4 h-4 mr-2" />
            Call
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList className="w-full justify-start rounded-none border-b bg-transparent px-4">
          <TabsTrigger value="catalog" className="data-[state=active]:border-b-2 data-[state=active]:border-primary">
            Catalog
          </TabsTrigger>
          <TabsTrigger value="about" className="data-[state=active]:border-b-2 data-[state=active]:border-primary">
            About
          </TabsTrigger>
          <TabsTrigger value="reviews" className="data-[state=active]:border-b-2 data-[state=active]:border-primary">
            Reviews
          </TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-y-auto">
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
                    <span className="text-sm font-medium">Show Out of Stock Items</span>
                    <Switch
                      checked={showOutOfStock}
                      onCheckedChange={setShowOutOfStock}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Customer Controls */}
            {!isOwner && catalogItems.some(item => !item.in_stock) && (
              <div className="mb-4 flex items-center justify-between p-3 border rounded-lg">
                <span className="text-sm font-medium">Show Out of Stock Items</span>
                <Switch
                  checked={showOutOfStock}
                  onCheckedChange={setShowOutOfStock}
                />
              </div>
            )}

            {loading ? (
              <div className="grid grid-cols-2 gap-3">
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
              <div className="grid grid-cols-2 gap-3">
                {filteredCatalogItems.map((item) => (
                  <Card
                    key={item.id}
                    className="overflow-hidden hover:shadow-lg transition-shadow relative"
                  >
                    <div 
                      className="relative aspect-square bg-muted cursor-pointer"
                      onClick={() => !isOwner && onViewCatalogItem(item)}
                    >
                      <Image
                        src={item.images[0] || "/placeholder.svg"}
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
                          <h4 className="font-semibold text-sm text-foreground truncate">{item.title}</h4>
                          <p className="text-lg font-bold text-primary">₦{item.price.toLocaleString()}</p>
                        </div>
                        
                        {/* Owner Controls */}
                        {isOwner && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <CreateCatalogItemDialog
                                businessId={business.id}
                                itemToEdit={item}
                                onSuccess={refreshCatalog}
                              >
                                <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                                  <Edit className="mr-2 h-4 w-4" />
                                  Edit
                                </DropdownMenuItem>
                              </CreateCatalogItemDialog>
                              <DropdownMenuItem onClick={() => setItemToDelete(item.id)}>
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
                          <span className="text-xs text-muted-foreground">In Stock</span>
                          <Switch
                            checked={item.in_stock}
                            onCheckedChange={() => handleToggleStock(item.id, item.in_stock)}
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
            <AlertDialog open={!!itemToDelete} onOpenChange={() => setItemToDelete(null)}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Catalog Item?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This action cannot be undone. This will permanently delete this catalog item.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => itemToDelete && handleDeleteItem(itemToDelete)}
                    className="bg-destructive hover:bg-destructive/90"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </TabsContent>

          <TabsContent value="about" className="p-4 mt-0 space-y-4">
            <div>
              <h3 className="font-semibold text-foreground mb-2">About</h3>
              <p className="text-muted-foreground">{business.description}</p>
            </div>

            <div>
              <h3 className="font-semibold text-foreground mb-2">Contact Information</h3>
              <div className="space-y-2">
                {business.email && (
                  <div className="flex items-center gap-2">
                    <Mail className="w-4 h-4 text-muted-foreground" />
                    <span className="text-muted-foreground">{business.email}</span>
                  </div>
                )}
                {business.phone && (
                  <div className="flex items-center gap-2">
                    <Phone className="w-4 h-4 text-muted-foreground" />
                    <span className="text-muted-foreground">{business.phone}</span>
                  </div>
                )}
                <a 
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                    typeof business.location === 'string' 
                      ? business.location 
                      : business.location?.address 
                        ? business.location.address 
                        : [business.lga, business.state].filter(Boolean).join(", ")
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 hover:underline"
                >
                  <MapPin className="w-4 h-4 text-muted-foreground" />
                  <span className="text-muted-foreground" title={typeof business.location === 'string' ? business.location : business.location?.address || 'Location not specified'}>
                    {typeof business.location === 'string' 
                      ? shortenAddress(business.location, 50)
                      : business.location?.address 
                        ? shortenAddress(business.location.address, 50)
                        : (business.state || business.lga)
                          ? [business.lga, business.state].filter(Boolean).join(", ")
                          : 'Location not specified'
                    }
                  </span>
                </a>
                {business.website && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">{business.website}</span>
                  </div>
                )}
              </div>
            </div>

            <div>
              <h3 className="font-semibold text-foreground mb-2">Business Owner</h3>
              <div className="flex items-center gap-3">
                <Avatar className="w-12 h-12">
                  <AvatarImage src={business.owner_avatar || "/placeholder.svg"} />
                  <AvatarFallback>{business.owner_name?.[0] || "O"}</AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-semibold text-foreground">{business.owner_name}</p>
                  <p className="text-sm text-muted-foreground">Owner</p>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="reviews" className="p-4 mt-0 space-y-4">
            {loading ? (
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
                      <AvatarImage src={review.users?.avatar_url || "/placeholder.svg"} />
                      <AvatarFallback>{review.users?.name?.[0] || "U"}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="font-semibold text-foreground">{review.users?.name || "Anonymous"}</p>
                        <div className="flex items-center gap-1">
                          <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                          <span className="text-sm">{review.rating}</span>
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground">{review.comment}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(review.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </Card>
              ))
            ) : (
              <div className="text-center py-8">
                <p className="text-muted-foreground">No reviews yet. Be the first to review this business!</p>
              </div>
            )}
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
