"use client";

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/use-supabase-auth';
import { ItemTrackingService, SoldItemHistory } from '@/lib/item-tracking-service';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { 
  Package, 
  Calendar, 
  User, 
  CreditCard,
  MessageCircle,
  ExternalLink,
  TrendingUp,
  ArrowLeft
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import Image from 'next/image';
import { useRouter } from 'next/navigation';

export default function SoldItemsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  
  const [soldItems, setSoldItems] = useState<SoldItemHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalEarnings, setTotalEarnings] = useState(0);

  const fetchSoldItems = useCallback(async () => {
    try {
      const data = await ItemTrackingService.getUserSoldItems(user!.id);
      setSoldItems(data);
      
      // Calculate total earnings
      const total = data.reduce((sum, item) => sum + item.sellerAmount, 0);
      setTotalEarnings(total);
    } catch (error) {
      console.error('Error fetching sold items:', error);
      toast({
        title: "Error",
        description: "Failed to load sold items.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [user, toast]);

  useEffect(() => {
    if (!user) {
      router.push('/signin');
      return;
    }

    fetchSoldItems();
  }, [user, router, fetchSoldItems]);

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      'pending': { color: 'bg-yellow-500', text: 'Pending Payment' },
      'paid': { color: 'bg-blue-500', text: 'Payment Received' },
      'shipped': { color: 'bg-purple-500', text: 'Shipped' },
      'delivered': { color: 'bg-green-500', text: 'Delivered' },
      'completed': { color: 'bg-green-600', text: 'Completed' },
      'disputed': { color: 'bg-red-500', text: 'Disputed' },
      'cancelled': { color: 'bg-gray-500', text: 'Cancelled' },
    };

    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.pending;
    
    return (
      <Badge className={`${config.color} text-foreground`}>
        {config.text}
      </Badge>
    );
  };

  const handleViewTransaction = (transactionId: string) => {
    router.push(`/transactions/${transactionId}`);
  };

  const handleMessageBuyer = (buyerId: string, itemId: string) => {
    router.push(`/messages?user=${buyerId}&item=${itemId}`);
  };

  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-background">
        <div className="sticky top-0 z-50 flex items-center gap-3 px-4 py-4 bg-background/95 backdrop-blur-sm border-b border-border">
          <button onClick={() => router.back()} className="p-2 -ml-2 rounded-full hover:bg-muted transition-colors">
            <ArrowLeft className="w-5 h-5 text-foreground" />
          </button>
          <div>
            <h1 className="font-sans font-bold text-xl text-foreground">Sold Items</h1>
            <p className="font-sans text-xs text-muted-foreground mt-0.5">Items you&apos;ve sold</p>
          </div>
        </div>
        <div className="max-w-4xl mx-auto space-y-6 p-4">
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <Skeleton className="h-32 w-full mb-4" />
                  <Skeleton className="h-4 w-3/4 mb-2" />
                  <Skeleton className="h-3 w-1/2 mb-4" />
                  <Skeleton className="h-8 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background">
      <div className="sticky top-0 z-50 flex items-center gap-3 px-4 py-4 bg-background/95 backdrop-blur-sm border-b border-border">
        <button onClick={() => router.back()} className="p-2 -ml-2 rounded-full hover:bg-muted transition-colors">
          <ArrowLeft className="w-5 h-5 text-foreground" />
        </button>
        <div>
          <h1 className="font-sans font-bold text-xl text-foreground">Sold Items</h1>
          <p className="font-sans text-xs text-muted-foreground mt-0.5">Items you&apos;ve sold</p>
        </div>
      </div>
      <div className="max-w-4xl mx-auto space-y-6 p-4">

        {/* Earnings Summary */}
        {soldItems.length > 0 && (
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold">Total Earnings</h3>
                  <p className="text-sm text-muted-foreground">
                    From {soldItems.length} sold item{soldItems.length !== 1 ? 's' : ''}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-green-600">
                    ₦{totalEarnings.toLocaleString()}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    After platform fees
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {soldItems.length === 0 ? (
          <Card>
            <CardContent className="text-center p-8">
              <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Items Sold Yet</h3>
              <p className="text-muted-foreground mb-4">
                You haven&apos;t sold any items yet. Start listing items in the marketplace!
              </p>
              <Button onClick={() => router.push('/marketplace')}>
                List an Item
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {soldItems.map((soldItem) => (
              <Card key={soldItem.id} className="overflow-hidden">
                <div className="relative">
                  <Image
                    src={soldItem.item.image_urls?.[0] || "/placeholder.svg"}
                    alt={soldItem.item.title || soldItem.item.text || "Item"}
                    width={300}
                    height={200}
                    className="w-full h-32 object-cover"
                  />
                  <div className="absolute top-2 right-2">
                    {getStatusBadge(soldItem.status)}
                  </div>
                </div>
                
                <CardContent className="p-4 space-y-3">
                  <div>
                    <h3 className="font-semibold line-clamp-1">
                      {soldItem.item.title || soldItem.item.text || "Untitled Item"}
                    </h3>
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {soldItem.item.description || soldItem.item.text}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Avatar className="h-6 w-6">
                      <AvatarImage src={soldItem.buyer.avatar_url || "/placeholder.svg"} />
                      <AvatarFallback className="text-xs">
                        {soldItem.buyer.name?.slice(0, 2).toUpperCase() || "B"}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm text-muted-foreground">
                      Sold to {soldItem.buyer.name}
                    </span>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Sold on:</span>
                      <span>{new Date(soldItem.soldAt).toLocaleDateString()}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Item Price:</span>
                      <span>₦{soldItem.amount.toLocaleString()}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Platform Fee:</span>
                      <span className="text-red-500">-₦{soldItem.commission.toLocaleString()}</span>
                    </div>
                    <div className="flex items-center justify-between font-semibold">
                      <span>You Earned:</span>
                      <span className="text-green-600">₦{soldItem.sellerAmount.toLocaleString()}</span>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button 
                      onClick={() => handleViewTransaction(soldItem.transactionId)}
                      variant="outline" 
                      size="sm"
                      className="flex-1"
                    >
                      <ExternalLink className="mr-1 h-3 w-3" />
                      View Details
                    </Button>
                    <Button 
                      onClick={() => handleMessageBuyer(soldItem.buyer.id, soldItem.item.id)}
                      variant="outline" 
                      size="sm"
                    >
                      <MessageCircle className="h-3 w-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
