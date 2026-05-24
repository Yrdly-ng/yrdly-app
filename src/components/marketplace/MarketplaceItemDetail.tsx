"use client";

import React, { useState } from 'react';
import Image from 'next/image';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { BuyButton } from '@/components/escrow/BuyButton';
import { ClaimButton } from '@/components/escrow/ClaimButton';
import { ChatButton } from '@/components/escrow/ChatButton';
import { useAuth } from '@/hooks/use-supabase-auth';
import { ImageSwiper } from '@/components/ImageSwiper';
import { Edit, Trash2, MapPin, User, Calendar, X, ChevronLeft, ChevronRight, Maximize2 } from 'lucide-react';
import { Post } from '@/types';
import { timeAgo } from '@/lib/utils';

interface MarketplaceItemDetailProps {
  item: Post;
  isOpen: boolean;
  onClose: () => void;
  onEditItem?: (item: Post) => void;
  onDeleteItem?: (itemId: string) => void;
}

export function MarketplaceItemDetail({ 
  item, 
  isOpen, 
  onClose, 
  onEditItem, 
  onDeleteItem 
}: MarketplaceItemDetailProps) {
  const { user } = useAuth();
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const isOwner = user?.id === item.user_id;
  const hasImages = item.image_urls && item.image_urls.length > 0;
  const images = hasImages ? item.image_urls : ['/placeholder-item.jpg'];

  const handleDelete = async () => {
    if (!onDeleteItem) return;
    
    setIsDeleting(true);
    try {
      await onDeleteItem(item.id);
      setIsDeleteDialogOpen(false);
      onClose();
    } catch (error) {
      console.error('Failed to delete item:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: 'NGN',
      minimumFractionDigits: 0
    }).format(price);
  };

  const nextImage = () => {
    if (!images || images.length === 0) return;
    setCurrentImageIndex((prev) => (prev + 1) % images.length);
  };

  const prevImage = () => {
    if (!images || images.length === 0) return;
    setCurrentImageIndex((prev) => (prev - 1 + images.length) % images.length);
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" hideClose>
          <DialogHeader className="flex flex-row items-center justify-between">
            <div>
              <DialogTitle className="text-xl font-bold">
                {item.title || item.text}
              </DialogTitle>
              <DialogDescription>
                View details and purchase this marketplace item
              </DialogDescription>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </DialogHeader>

          <div className="space-y-6">
            {/* Image Carousel */}
            <div className="space-y-3">
              {/* Main swipeable frame */}
              <div className="relative aspect-square w-full max-w-md mx-auto rounded-2xl overflow-hidden bg-muted">
                {/* Sliding strip */}
                <div
                  className="absolute inset-0 flex transition-transform duration-300 ease-out"
                  style={{ transform: `translateX(-${currentImageIndex * 100}%)` }}
                >
                  {images!.map((src, i) => (
                    <div
                      key={i}
                      className="relative w-full h-full flex-shrink-0 cursor-zoom-in"
                      onClick={() => setLightboxOpen(true)}
                    >
                      <Image
                        src={src}
                        alt={`${item.title || 'Item'} — image ${i + 1}`}
                        fill
                        className="object-cover"
                        sizes="(max-width: 768px) 100vw, 448px"
                        priority={i === 0}
                      />
                    </div>
                  ))}
                </div>

                {/* Prev / Next arrows */}
                {images!.length > 1 && (
                  <>
                    <Button
                      variant="secondary"
                      size="icon"
                      className="absolute left-2 top-1/2 -translate-y-1/2 bg-white/90 hover:bg-white h-8 w-8"
                      onClick={prevImage}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="secondary"
                      size="icon"
                      className="absolute right-2 top-1/2 -translate-y-1/2 bg-white/90 hover:bg-white h-8 w-8"
                      onClick={nextImage}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </>
                )}

                {/* Dot indicators */}
                {images!.length > 1 && (
                  <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
                    {images!.map((_, i) => (
                      <button
                        key={i}
                        onClick={() => setCurrentImageIndex(i)}
                        className={`rounded-full transition-all duration-200 ${
                          i === currentImageIndex ? "w-4 h-1.5 bg-white" : "w-1.5 h-1.5 bg-white/50"
                        }`}
                      />
                    ))}
                  </div>
                )}

                {/* Counter + expand button */}
                <div className="absolute top-2 right-2 flex items-center gap-1.5">
                  {images!.length > 1 && (
                    <span className="bg-black/50 text-foreground text-xs px-2 py-0.5 rounded-full">
                      {currentImageIndex + 1} / {images!.length}
                    </span>
                  )}
                  <button
                    onClick={() => setLightboxOpen(true)}
                    className="w-7 h-7 rounded-full bg-black/50 flex items-center justify-center hover:bg-black/70 transition"
                  >
                    <Maximize2 className="w-3.5 h-3.5 text-foreground" />
                  </button>
                </div>
              </div>

              {/* Thumbnail strip */}
              {images!.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-1 max-w-md mx-auto">
                  {images!.map((image, index) => (
                    <button
                      key={index}
                      onClick={() => setCurrentImageIndex(index)}
                      className={`relative w-14 h-14 rounded-lg overflow-hidden flex-shrink-0 transition-all ${
                        index === currentImageIndex ? 'ring-2 ring-primary ring-offset-1' : 'opacity-60 hover:opacity-100'
                      }`}
                    >
                      <Image src={image} alt={`Thumbnail ${index + 1}`} fill className="object-cover" sizes="56px" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Lightbox */}
            <ImageSwiper
              images={images!}
              isOpen={lightboxOpen}
              onClose={() => setLightboxOpen(false)}
              initialIndex={currentImageIndex}
            />

            {/* Item Details */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left Column - Basic Info */}
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold">Item Details</h3>
                      {isOwner && (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onEditItem?.(item)}
                          >
                            <Edit className="w-4 h-4 mr-2" />
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => setIsDeleteDialogOpen(true)}
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            Delete
                          </Button>
                        </div>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Price */}
                    {item.is_sold ? (
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Status:</span>
                        <Badge className="bg-red-600 text-white px-3 py-1 text-lg font-bold uppercase tracking-wider">
                          Sold
                        </Badge>
                      </div>
                    ) : item.price !== undefined && item.price !== null && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Price:</span>
                        <Badge className="bg-green-600 text-white px-3 py-1 text-lg font-bold">
                          {item.price === 0 ? "Free" : formatPrice(item.price)}
                        </Badge>
                      </div>
                    )}

                    {/* Description */}
                    {item.description && (
                      <div>
                        <h4 className="font-medium mb-2">Description</h4>
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                          {item.description}
                        </p>
                      </div>
                    )}

                    {/* Condition */}
                    {item.condition && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Condition:</span>
                        <Badge variant="outline">{item.condition}</Badge>
                      </div>
                    )}

                    {/* Category */}
                    {item.category && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Category:</span>
                        <Badge variant="secondary">{item.category}</Badge>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Seller Info */}
                <Card>
                  <CardHeader>
                    <h3 className="text-lg font-semibold">Seller Information</h3>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center space-x-3">
                      <div className="w-12 h-12 rounded-full overflow-hidden bg-primary/10 flex items-center justify-center">
                        {item.author_image ? (
                          <Image
                            src={item.author_image}
                            alt={item.author_name || 'Seller'}
                            width={48}
                            height={48}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <User className="w-6 h-6 text-primary" />
                        )}
                      </div>
                      <div>
                        <p className="font-medium">{item.author_name || 'Unknown Seller'}</p>
                        <p className="text-sm text-muted-foreground">Neighborhood Member</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                      <Calendar className="w-4 h-4" />
                      <span>Posted {timeAgo(new Date(item.timestamp))}</span>
                    </div>

                    <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                      <MapPin className="w-4 h-4" />
                      <span>{item.state ? `${item.lga ? item.lga + ', ' : ''}${item.state}` : 'Location Not Specified'}</span>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Right Column - Actions */}
              <div className="space-y-4">
                {/* Action Buttons */}
                {!isOwner && !item.is_sold && (
                  <div className="space-y-3">
                    {Number(item.price) > 0 ? (
                      <BuyButton
                        itemId={item.id}
                        itemTitle={item.title || item.text || 'Unknown Item'}
                        price={item.price}
                        sellerId={item.user_id}
                        sellerName={item.author_name || 'Unknown Seller'}
                      />
                    ) : (
                      <ClaimButton
                        itemId={item.id}
                        itemTitle={item.title || item.text || 'Unknown Item'}
                        sellerId={item.user_id}
                      />
                    )}

                    <ChatButton
                      itemId={item.id}
                      itemTitle={item.title || item.text || 'Unknown Item'}
                      itemImageUrl={images?.[0] || ''}
                      sellerId={item.user_id}
                      sellerName={item.author_name || 'Unknown Seller'}
                      itemPrice={item.price}
                    />
                  </div>
                )}

                {/* Owner Message */}
                {isOwner && (
                  <Card>
                    <CardContent className="pt-6">
                      <div className="text-center text-muted-foreground">
                        <p className="mb-2">This is your item.</p>
                        <p className="text-sm">Use the edit/delete buttons above to manage it.</p>
                      </div>
                    </CardContent>
                  </Card>
                )}

              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Item</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <p className="text-muted-foreground">
              Are you sure you want to delete &quot;{item.title || item.text}&quot;? This action cannot be undone.
            </p>
            
            <div className="flex justify-end space-x-2">
              <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>
                Cancel
              </Button>
              <Button 
                variant="destructive" 
                onClick={handleDelete}
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
