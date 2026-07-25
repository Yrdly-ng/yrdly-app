"use client";

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/use-supabase-auth';
import { ItemTrackingService, PurchaseHistory } from '@/lib/item-tracking-service';
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
  ArrowLeft
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import Image from 'next/image';
import { useRouter } from 'next/navigation';

export default function PurchaseHistoryPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  
  const [purchases, setPurchases] = useState<PurchaseHistory[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPurchases = useCallback(async () => {
    try {
      const data = await ItemTrackingService.getUserPurchases(user!.id);
      setPurchases(data);
    } catch (error) {
      console.error('Error fetching purchases:', error);
      toast({
        title: "Error",
        description: "Failed to load purchase history.",
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

    fetchPurchases();
  }, [user, router, fetchPurchases]);

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

  const handleMessageSeller = (sellerId: string, itemId: string) => {
    router.push(`/messages?user=${sellerId}&item=${itemId}`);
  };

  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-background">
        <div className="sticky top-[calc(4rem+env(safe-area-inset-top))] md:top-[calc(84px+env(safe-area-inset-top))] z-40 flex items-center gap-3 px-4 py-4 bg-card border-b border-border shadow-sm">
          <button onClick={() => router.back()} className="p-2 -ml-2 rounded-full hover:bg-muted transition-colors">
            <ArrowLeft className="w-5 h-5 text-foreground" />
          </button>
          <div>
            <h1 className="font-sans font-bold text-xl text-foreground">Purchase History</h1>
            <p className="font-sans text-xs text-muted-foreground mt-0.5">Items you&apos;ve purchased</p>
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
      <div className="sticky top-[calc(4rem+env(safe-area-inset-top))] md:top-[calc(84px+env(safe-area-inset-top))] z-40 flex items-center gap-3 px-4 py-4 bg-card border-b border-border shadow-sm">
        <button onClick={() => router.back()} className="p-2 -ml-2 rounded-full hover:bg-muted transition-colors">
          <ArrowLeft className="w-5 h-5 text-foreground" />
        </button>
        <div>
          <h1 className="font-sans font-bold text-xl text-foreground">Purchase History</h1>
          <p className="font-sans text-xs text-muted-foreground mt-0.5">Items you&apos;ve purchased</p>
        </div>
      </div>
      <div className="max-w-4xl mx-auto space-y-6 p-4">

        {purchases.length === 0 ? (
          <div
            className="text-center p-8 md:p-12 rounded-2xl mx-4 my-6"
            style={{
              background: "var(--c-card)",
              border: "1px solid var(--c-border)",
              boxShadow: "0 10px 30px rgba(0,0,0,0.2)"
            }}
          >
            <div className="flex justify-center mb-6">
              <span 
                className="text-6xl animate-bounce" 
                role="img" 
                aria-label="Shopping Bag"
                style={{ animationDuration: '2s' }}
              >
                🛍️
              </span>
            </div>
            
            <h2 
              className="text-2xl font-extrabold mb-3"
              style={{ 
                fontFamily: "var(--font-jersey25)", 
                color: "var(--c-text)",
                letterSpacing: "-0.02em"
              }}
            >
              No Purchases Yet
            </h2>
            
            <p 
              className="mb-8 max-w-sm mx-auto text-[0.9375rem] leading-relaxed"
              style={{ 
                fontFamily: "var(--font-work-sans)", 
                color: "var(--c-text-muted)" 
              }}
            >
              You haven&apos;t purchased any items yet. Start shopping in the marketplace!
            </p>
            
            <Button 
              onClick={() => router.push('/marketplace')}
              className="w-full sm:w-auto px-8 py-6 rounded-full flex items-center justify-center font-bold mx-auto transition-all active:scale-95 shadow-[0_8px_20px_rgba(56,142,60,0.25)] hover:shadow-[0_10px_25px_rgba(56,142,60,0.35)]"
              style={{
                background: "hsl(var(--primary))",
                fontFamily: "var(--font-work-sans)",
                letterSpacing: "0.02em"
              }}
            >
              Browse Marketplace
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {purchases.map((purchase) => (
              <Card key={purchase.id} className="overflow-hidden">
                <div className="relative">
                  <Image
                    src={purchase.item.image_urls?.[0] || "/placeholder.svg"}
                    alt={purchase.item.title || purchase.item.text || "Item"}
                    width={300}
                    height={200}
                    className="w-full h-32 object-cover"
                  />
                  <div className="absolute top-2 right-2">
                    {getStatusBadge(purchase.status)}
                  </div>
                </div>
                
                <CardContent className="p-4 space-y-3">
                  <div>
                    <h3 className="font-semibold line-clamp-1">
                      {purchase.item.title || purchase.item.text || "Untitled Item"}
                    </h3>
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {purchase.item.description || purchase.item.text}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Avatar className="h-6 w-6">
                      <AvatarImage src={purchase.seller.avatar_url || "/placeholder.svg"} />
                      <AvatarFallback className="text-xs">
                        {purchase.seller.name?.slice(0, 2).toUpperCase() || "S"}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm text-muted-foreground">
                      {purchase.seller.name}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {new Date(purchase.purchasedAt).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="text-lg font-bold text-primary">
                      ₦{purchase.amount.toLocaleString()}
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button 
                      onClick={() => handleViewTransaction(purchase.transactionId)}
                      variant="outline" 
                      size="sm"
                      className="flex-1"
                    >
                      <ExternalLink className="mr-1 h-3 w-3" />
                      View Details
                    </Button>
                    <Button 
                      onClick={() => handleMessageSeller(purchase.seller.id, purchase.item.id)}
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
