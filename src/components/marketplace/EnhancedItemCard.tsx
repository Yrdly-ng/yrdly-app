"use client";

import React, { useState } from 'react';
import Image from 'next/image';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { BuyButton } from '@/components/escrow/BuyButton';
import { ClaimButton } from '@/components/escrow/ClaimButton';
import { ChatButton } from '@/components/escrow/ChatButton';
import { useAuth } from '@/hooks/use-supabase-auth';
import { Edit, Trash2, MapPin, User, Calendar, Eye } from 'lucide-react';
import { Post } from '@/types';
import { MarketplaceItemDetail } from './MarketplaceItemDetail';

interface EnhancedItemCardProps {
  item: Post;
  onEditItem?: (item: Post) => void;
  onDeleteItem?: (itemId: string) => void;
}

export function EnhancedItemCard({ item, onEditItem, onDeleteItem }: EnhancedItemCardProps) {
  const { user } = useAuth();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  const isOwner = user?.id === item.user_id;
  const hasImages = item.image_urls && item.image_urls.length > 0;
  const firstImage = hasImages && item.image_urls ? item.image_urls[0] : '/placeholder-item.jpg';

  const handleDelete = async () => {
    if (!onDeleteItem) return;
    
    setIsDeleting(true);
    try {
      await onDeleteItem(item.id);
      setIsDeleteDialogOpen(false);
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

  const formatDate = (date: any) => {
    if (!date) return 'Unknown date';
    
    const dateObj = date instanceof Date ? date : date.toDate ? date.toDate() : new Date(date);
    return new Intl.DateTimeFormat('en-NG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    }).format(dateObj);
  };

  return (
    <>
      <Card className="h-full flex flex-col hover:shadow-lg transition-shadow">
        {/* Image Section */}
        <div 
          className="relative aspect-square overflow-hidden rounded-t-lg cursor-pointer"
          onClick={() => setIsDetailOpen(true)}
        >
          <Image
            src={firstImage}
            alt={item.title || 'Item image'}
            fill
            className="object-cover hover:scale-105 transition-transform duration-300"
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          />
          
          {/* Price Badge */}
          {item.is_sold ? (
            <div className="absolute top-3 right-3">
              <Badge className="bg-red-600 text-white px-3 py-1 text-sm font-semibold uppercase tracking-wider">
                Sold
              </Badge>
            </div>
          ) : item.price !== undefined && item.price !== null && (
            <div className="absolute top-3 right-3">
              <Badge className="bg-green-600 text-white px-3 py-1 text-sm font-semibold">
                {item.price === 0 ? "Free" : formatPrice(item.price)}
              </Badge>
            </div>
          )}

          {/* Owner Actions */}
          {isOwner && (
            <div className="absolute top-3 left-3 flex space-x-2">
              <Button
                size="sm"
                variant="secondary"
                className="w-8 h-8 p-0 bg-white/90 hover:bg-white"
                onClick={() => onEditItem?.(item)}
              >
                <Edit className="w-4 h-4 text-gray-700 dark:text-gray-300" />
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="w-8 h-8 p-0 bg-red-500/90 hover:bg-red-500"
                onClick={() => setIsDeleteDialogOpen(true)}
              >
                <Trash2 className="w-4 h-4 text-foreground" />
              </Button>
            </div>
          )}
        </div>

        {/* Content */}
        <CardHeader className="pb-3">
          <div className="space-y-2">
            <h3 className="font-semibold text-lg text-foreground line-clamp-2">
              {item.title || item.text}
            </h3>
            
            {item.description && (
              <p className="text-muted-foreground dark:text-gray-300 text-sm line-clamp-2">
                {item.description}
              </p>
            )}
          </div>
        </CardHeader>

        <CardContent className="pb-3 flex-1">
          <div className="space-y-3">
            {/* Price */}
            {item.price && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground dark:text-gray-300">Price:</span>
                <span className="font-bold text-lg text-green-600 dark:text-green-400">
                  {formatPrice(item.price)}
                </span>
              </div>
            )}

            {/* Location */}
            <div className="flex items-center space-x-2 text-sm text-muted-foreground dark:text-gray-300">
              <MapPin className="w-4 h-4" />
              <span>Your Neighborhood</span>
            </div>

            {/* Author */}
            <div className="flex items-center space-x-2 text-sm text-muted-foreground dark:text-gray-300">
              <User className="w-4 h-4" />
              <span>{item.author_name || 'Unknown Seller'}</span>
            </div>

            {/* Date */}
            <div className="flex items-center space-x-2 text-sm text-muted-foreground dark:text-gray-300">
              <Calendar className="w-4 h-4" />
              <span>Posted {formatDate(item.timestamp)}</span>
            </div>
          </div>
        </CardContent>

        {/* Actions */}
        <CardFooter className="pt-0">
          <div className="w-full space-y-3">
            {/* View Details Button */}
            <Button 
              variant="outline" 
              className="w-full"
              onClick={() => setIsDetailOpen(true)}
            >
              <Eye className="w-4 h-4 mr-2" />
              View Details
            </Button>

            {/* Action Buttons - Only show if not owner and not sold */}
            {!isOwner && !item.is_sold && (
              item.price ? (
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
              )
            )}

            {/* Chat Button - Only show if not owner and not sold */}
            {!isOwner && !item.is_sold && (
              <ChatButton
                itemId={item.id}
                itemTitle={item.title || item.text || 'Unknown Item'}
                itemImageUrl={firstImage}
                sellerId={item.user_id}
                sellerName={item.author_name || 'Unknown Seller'}
                itemPrice={item.price}
              />
            )}

            {/* Owner Message */}
            {isOwner && (
              <div className="text-center text-sm text-muted-foreground py-2">
                This is your item. Use the edit/delete buttons above to manage it.
              </div>
            )}
          </div>
        </CardFooter>
      </Card>

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
            
            <div className="flex space-x-3">
              <Button
                variant="outline"
                onClick={() => setIsDeleteDialogOpen(false)}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={isDeleting}
                className="flex-1"
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Item Detail View */}
      <MarketplaceItemDetail
        item={item}
        isOpen={isDetailOpen}
        onClose={() => setIsDetailOpen(false)}
        onEditItem={onEditItem}
        onDeleteItem={onDeleteItem}
      />
    </>
  );
}
