"use client";

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-supabase-auth';
import { TransactionStatusService } from '@/lib/transaction-status-service';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { 
  CheckCircle,
  Truck,
  Package,
  CreditCard,
  MessageCircle,
  AlertTriangle,
  Clock,
  User,
  Calendar,
  Star
} from 'lucide-react';
import { OpenDisputeDialog } from '@/components/disputes/OpenDisputeDialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { EscrowStatus, DeliveryOption } from '@/types/escrow';
import Image from 'next/image';
import { SubmitReviewDialog } from '@/components/reviews/SubmitReviewDialog';
import { ReviewService } from '@/lib/review-service';
import { AppHeader } from '@/components/AppHeader';
import { supabase } from '@/lib/supabase';
import { SupabaseChatService } from '@/lib/supabase-chat-service';

interface TransactionDetails {
  id: string;
  item_id: string;
  buyer_id: string;
  seller_id: string;
  amount: number;
  commission: number;
  seller_amount: number;
  status: EscrowStatus;
  payment_method: string;
  delivery_details: any;
  created_at: string;
  paid_at?: string;
  shipped_at?: string;
  delivered_at?: string;
  completed_at?: string;
  buyer: {
    id: string;
    name: string;
    avatar_url?: string;
    email: string;
  };
  seller: {
    id: string;
    name: string;
    avatar_url?: string;
    email: string;
  };
  item: {
    id: string;
    title?: string;
    text?: string;
    description?: string;
    image_urls?: string[];
    price: number;
  };
}

import { GlassCard } from '@/components/ui/glass-card';

export default function TransactionDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [transaction, setTransaction] = useState<TransactionDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [userReview, setUserReview] = useState<any | null>(null);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const transactionId = params.transactionId as string;

  const fetchTransactionDetails = useCallback(async () => {
    try {
      setError(null);
      const data = await TransactionStatusService.getTransactionDetails(transactionId);
      setTransaction(data);

      // Check if item is linked to a business
      if (data.item?.business_id && user) {
        setBusinessId(data.item.business_id);
        
        // Fetch user's review for this transaction (if buyer and completed)
        if (user.id === data.buyer_id && data.status === EscrowStatus.COMPLETED) {
          const review = await ReviewService.getUserReviewForTransaction(user.id, transactionId);
          setUserReview(review);
        }
      }

      // Auto-verify if buyer lands on page while status is still PENDING
      if (user && user.id === data.buyer_id && (data.status === EscrowStatus.PENDING || (data.status as string) === 'creating_escrow')) {
        try {
          const { supabase } = await import('@/lib/supabase');
          const { data: { session } } = await supabase.auth.getSession();
          const verifyRes = await fetch('/api/payment/verify', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {}),
            },
            body: JSON.stringify({ txRef: transactionId }),
          });
          const verifyResult = await verifyRes.json();
          if (verifyResult?.success) {
            const updatedData = await TransactionStatusService.getTransactionDetails(transactionId);
            setTransaction(updatedData);
          }
        } catch (verifyErr) {
          console.warn('[TransactionDetailsPage] Auto-verify check skipped:', verifyErr);
        }
      }
    } catch (error) {
      console.error('[v0] Error fetching transaction details:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to load transaction details.';
      setError(errorMessage);
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [transactionId, user, toast]);

  useEffect(() => {
    if (!user) {
      router.push('/signin');
      return;
    }

    fetchTransactionDetails();
  }, [user, transactionId, router, fetchTransactionDetails]);

  const handleStatusUpdate = async (action: 'shipped' | 'delivered' | 'completed') => {
    if (!user || !transaction) return;

    setActionLoading(true);
    try {
      switch (action) {
        case 'shipped':
          await TransactionStatusService.confirmShipped(transactionId, user.id);
          toast({
            title: "Item Marked as Shipped",
            description: "The buyer has been notified.",
          });
          break;
        case 'delivered':
          await TransactionStatusService.confirmDelivered(transactionId, user.id);
          toast({
            title: "Delivery Confirmed",
            description: "The seller will receive payment shortly.",
          });
          break;
        case 'completed':
          await TransactionStatusService.completeTransaction(transactionId);
          toast({
            title: "Transaction Completed",
            description: "Funds have been released to the seller.",
          });
          break;
      }
      
      // Refresh transaction details
      await fetchTransactionDetails();
    } catch (error) {
      console.error(`Error updating ${action}:`, error);
      toast({
        title: "Error",
        description: `Failed to update ${action} status.`,
        variant: "destructive",
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleMessageUser = async () => {
    if (!transaction || !user) return;
    
    try {
      setActionLoading(true);
      const itemTitle = transaction.item?.title || transaction.item?.text || transaction.item?.description || 'Item Inquiry';
      const itemImage = transaction.item?.image_urls?.[0] || '';
      const itemPrice = transaction.item?.price || transaction.amount;

      const chatId = await SupabaseChatService.getOrCreateChat(
        transaction.item_id,
        transaction.buyer_id,
        transaction.seller_id,
        itemTitle,
        itemImage,
        itemPrice
      );

      router.push(`/messages/${chatId}`);
    } catch (error) {
      console.error('Error opening chat:', error);
      toast({
        title: 'Error',
        description: 'Failed to open chat. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setActionLoading(false);
    }
  };

  const getStatusBadge = (status: EscrowStatus) => {
    const statusConfig = {
      [EscrowStatus.PENDING]: { color: 'bg-yellow-500', text: 'Pending Payment' },
      [EscrowStatus.PAID]: { color: 'bg-blue-500', text: 'Payment Received' },
      [EscrowStatus.SHIPPED]: { color: 'bg-purple-500', text: 'Shipped' },
      [EscrowStatus.DELIVERED]: { color: 'bg-green-500', text: 'Delivered' },
      [EscrowStatus.COMPLETED]: { color: 'bg-green-600', text: 'Completed' },
      [EscrowStatus.DISPUTED]: { color: 'bg-red-500', text: 'Disputed' },
      [EscrowStatus.CANCELLED]: { color: 'bg-gray-500', text: 'Cancelled' },
    };

    const config = statusConfig[status] || statusConfig[EscrowStatus.PENDING];
    
    return (
      <Badge className={`${config.color} text-foreground font-yrdly-body`}>
        {config.text}
      </Badge>
    );
  };

  const getActionButton = () => {
    if (!user || !transaction) return null;

    const isBuyer  = user.id === transaction.buyer_id;
    const isSeller = user.id === transaction.seller_id;

    switch (transaction.status) {
      case EscrowStatus.PAID:
        if (isSeller) {
          return (
            <Button
              onClick={() => router.push(`/transactions/${transactionId}/mark-sent`)}
              className="w-full font-yrdly-body"
            >
              <Truck className="mr-2 h-4 w-4" />
              Mark as Sent
            </Button>
          );
        }
        break;

      case EscrowStatus.SHIPPED:
        if (isBuyer) {
          return (
            <Button
              onClick={() => router.push(`/transactions/${transactionId}/confirm-receipt`)}
              className="w-full font-yrdly-body"
            >
              <Package className="mr-2 h-4 w-4" />
              Confirm Receipt
            </Button>
          );
        }
        break;

      case EscrowStatus.DELIVERED:
        if (isBuyer) {
          return (
            <Button
              onClick={() => router.push(`/transactions/${transactionId}/confirm-receipt`)}
              className="w-full font-yrdly-body"
            >
              <CheckCircle className="mr-2 h-4 w-4" />
              Confirm &amp; Release Funds
            </Button>
          );
        }
        break;
    }

    return null;
  };

  const getDeliveryMethodText = (deliveryDetails: any) => {
    if (deliveryDetails.option === DeliveryOption.FACE_TO_FACE) {
      return 'Face-to-Face Meetup';
    } else if (deliveryDetails.option === DeliveryOption.SELLER_DELIVERY) {
      return 'Seller Delivery';
    }
    return 'Unknown';
  };

  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-[var(--yrdly-dark)] text-foreground font-yrdly-body flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-[var(--yrdly-label)] font-yrdly-body">Loading transaction details...</p>
        </div>
      </div>
    );
  }

  if (!transaction) {
    return (
      <div className="min-h-[100dvh] bg-[var(--yrdly-dark)] text-foreground font-yrdly-body flex items-center justify-center p-4">
        <GlassCard className="w-full max-w-md p-6 text-center space-y-4">
          <AlertTriangle className="h-12 w-12 text-orange-500 mx-auto" />
          <div>
            <h3 className="text-lg font-yrdly-display font-semibold mb-2">Transaction Not Found</h3>
            <p className="text-sm font-yrdly-body text-[var(--yrdly-label)] mb-4">
              {error || "The transaction you're looking for doesn't exist or you don't have access to it."}
            </p>
          </div>
          
          {error && error.includes('logged in') && (
            <Alert className="bg-blue-500/10 border-blue-500/30 text-blue-300 font-yrdly-body">
              <AlertDescription className="text-sm">
                Please sign in to view your transaction details.
              </AlertDescription>
            </Alert>
          )}
          
          {error && error.includes('access') && (
            <Alert className="bg-yellow-500/10 border-yellow-500/30 text-yellow-300 font-yrdly-body">
              <AlertDescription className="text-sm">
                This transaction may have been cancelled or deleted. Contact support if you believe this is an error.
              </AlertDescription>
            </Alert>
          )}
          
          <div className="flex flex-col gap-2 font-yrdly-body">
            {retryCount < 3 && (
              <Button 
                onClick={() => {
                  setRetryCount(prev => prev + 1);
                  setLoading(true);
                  fetchTransactionDetails();
                }}
                variant="outline"
                className="border-[var(--yrdly-glass-border)] text-foreground"
              >
                Try Again
              </Button>
            )}
            <Button onClick={() => router.push('/marketplace')} variant="default">
              Back to Marketplace
            </Button>
          </div>
        </GlassCard>
      </div>
    );
  }

  const isBuyer = user?.id === transaction.buyer_id;
  const otherUser = isBuyer ? transaction.seller : transaction.buyer;

  return (
    <div className="min-h-[100dvh] bg-[var(--yrdly-dark)] text-foreground font-yrdly-body">
      <AppHeader 
        title="Transaction Details" 
        onBack={() => {
          if (window.history.length <= 1) {
            router.push('/profile/purchases');
          } else {
            router.back();
          }
        }} 
      />
      <div className="p-4">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[var(--yrdly-label)] font-yrdly-body">Transaction ID: {transaction.id}</p>
            </div>
            {getStatusBadge(transaction.status)}
          </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Item Details */}
          <GlassCard className="p-6 space-y-4">
            <h3 className="flex items-center gap-2 font-yrdly-display font-bold text-lg text-foreground">
              <Package className="h-5 w-5 text-primary" />
              Item Details
            </h3>
            <div className="flex gap-4">
              <div className="w-20 h-20 relative rounded-lg overflow-hidden border border-[var(--yrdly-glass-border)]">
                <Image
                  src={transaction.item.image_urls?.[0] || "/placeholder.svg"}
                  alt={transaction.item.title || transaction.item.text || "Item"} fill sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                  className="object-cover"
                />
              </div>
              <div className="flex-1">
                <h3 className="font-yrdly-display font-semibold text-foreground">
                  {transaction.item.title || transaction.item.text || "Untitled Item"}
                </h3>
                <p className="text-sm font-yrdly-body text-[var(--yrdly-label)]">
                  {transaction.item.description || transaction.item.text}
                </p>
                <p className="text-lg font-yrdly-display font-bold text-primary mt-2">
                  ₦{transaction.amount.toLocaleString()}
                </p>
              </div>
            </div>
          </GlassCard>

          {/* Transaction Summary */}
          <GlassCard className="p-6 space-y-3">
            <h3 className="flex items-center gap-2 font-yrdly-display font-bold text-lg text-foreground">
              <CreditCard className="h-5 w-5 text-primary" />
              Payment Summary
            </h3>
            <div className="flex justify-between font-yrdly-body text-sm">
              <span className="text-[var(--yrdly-label)]">Item Price:</span>
              <span className="text-foreground">₦{transaction.amount.toLocaleString()}</span>
            </div>
            <div className="flex justify-between font-yrdly-body text-sm">
              <span className="text-[var(--yrdly-label)]">Platform Fee (3%):</span>
              <span className="text-foreground">₦{transaction.commission.toLocaleString()}</span>
            </div>
            <Separator className="bg-[var(--yrdly-glass-border)]" />
            <div className="flex justify-between font-yrdly-body text-sm">
              <span className="text-[var(--yrdly-label)]">Seller Receives:</span>
              <span className="font-semibold text-foreground">₦{transaction.seller_amount.toLocaleString()}</span>
            </div>
            <div className="flex justify-between font-yrdly-display text-lg font-bold">
              <span className="text-foreground">You Paid:</span>
              <span className="text-primary">₦{transaction.amount.toLocaleString()}</span>
            </div>
          </GlassCard>

          {/* User Information */}
          <GlassCard className="p-6 space-y-4">
            <h3 className="flex items-center gap-2 font-yrdly-display font-bold text-lg text-foreground">
              <User className="h-5 w-5 text-primary" />
              {isBuyer ? 'Seller' : 'Buyer'} Information
            </h3>
            <div className="flex items-center gap-3">
              <Avatar className="h-12 w-12">
                <AvatarImage src={otherUser.avatar_url || "/placeholder.svg"} />
                <AvatarFallback className="font-yrdly-display">
                  {otherUser.name?.slice(0, 2).toUpperCase() || "U"}
                </AvatarFallback>
              </Avatar>
              <div>
                <h3 className="font-yrdly-display font-semibold text-foreground">{otherUser.name}</h3>
                <p className="text-sm font-yrdly-body text-[var(--yrdly-label)]">{otherUser.email}</p>
              </div>
            </div>
            <Button 
              onClick={handleMessageUser}
              disabled={actionLoading}
              variant="outline" 
              className="w-full font-yrdly-body border-[var(--yrdly-glass-border)] text-foreground"
            >
              <MessageCircle className="mr-2 h-4 w-4" />
              Message {isBuyer ? 'Seller' : 'Buyer'}
            </Button>
          </GlassCard>

          {/* Delivery Information */}
          <GlassCard className="p-6 space-y-3">
            <h3 className="flex items-center gap-2 font-yrdly-display font-bold text-lg text-foreground">
              <Truck className="h-5 w-5 text-primary" />
              Delivery Information
            </h3>
            <div className="flex justify-between font-yrdly-body text-sm">
              <span className="text-[var(--yrdly-label)]">Method:</span>
              <span className="text-foreground">{getDeliveryMethodText(transaction.delivery_details)}</span>
            </div>
            {transaction.delivery_details.notes && (
              <div className="font-yrdly-body">
                <span className="text-[var(--yrdly-label)]">Notes:</span>
                <p className="text-sm mt-1 text-foreground">{transaction.delivery_details.notes}</p>
              </div>
            )}
            <Alert className="bg-[var(--yrdly-glass-bg)] border border-[var(--yrdly-glass-border)] text-foreground font-yrdly-body">
              <MessageCircle className="h-4 w-4 text-primary" />
              <AlertDescription>
                Discuss delivery details with the {isBuyer ? 'seller' : 'buyer'} via chat.
              </AlertDescription>
            </Alert>
          </GlassCard>
        </div>

        {/* Transaction Timeline */}
        <GlassCard className="p-6 space-y-4">
          <h3 className="flex items-center gap-2 font-yrdly-display font-bold text-lg text-foreground">
            <Clock className="h-5 w-5 text-primary" />
            Transaction Timeline
          </h3>
          <div className="space-y-4 font-yrdly-body">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 bg-green-500 rounded-full"></div>
              <div>
                <p className="font-medium text-foreground">Transaction Created</p>
                <p className="text-sm text-[var(--yrdly-label)]">
                  {new Date(transaction.created_at).toLocaleString()}
                </p>
              </div>
            </div>
            
            {transaction.paid_at && (
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                <div>
                  <p className="font-medium text-foreground">Payment Confirmed</p>
                  <p className="text-sm text-[var(--yrdly-label)]">
                    {new Date(transaction.paid_at).toLocaleString()}
                  </p>
                </div>
              </div>
            )}
            
            {transaction.shipped_at && (
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 bg-purple-500 rounded-full"></div>
                <div>
                  <p className="font-medium text-foreground">Item Shipped</p>
                  <p className="text-sm text-[var(--yrdly-label)]">
                    {new Date(transaction.shipped_at).toLocaleString()}
                  </p>
                </div>
              </div>
            )}
            
            {transaction.delivered_at && (
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                <div>
                  <p className="font-medium text-foreground">Delivery Confirmed</p>
                  <p className="text-sm text-[var(--yrdly-label)]">
                    {new Date(transaction.delivered_at).toLocaleString()}
                  </p>
                </div>
              </div>
            )}
            
            {transaction.completed_at && (
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 bg-green-600 rounded-full"></div>
                <div>
                  <p className="font-medium text-foreground">Transaction Completed</p>
                  <p className="text-sm text-[var(--yrdly-label)]">
                    {new Date(transaction.completed_at).toLocaleString()}
                  </p>
                </div>
              </div>
            )}
          </div>
        </GlassCard>

        {/* Action Buttons */}
        <div className="flex flex-col gap-4 font-yrdly-body">
          {getActionButton() && (
            <div className="flex justify-center">
              {getActionButton()}
            </div>
          )}
          
          {/* Dispute Button */}
          {transaction.status !== 'completed' && transaction.status !== 'cancelled' && transaction.status !== 'disputed' && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                className="border-red-500/40 text-red-400 hover:bg-red-500/10 font-yrdly-body"
                onClick={() => router.push(`/transactions/${transactionId}/dispute`)}
              >
                <AlertTriangle className="mr-2 h-4 w-4" />
                Open Dispute
              </Button>
            </div>
          )}

          {/* Review Section - Only for completed transactions linked to a business */}
          {transaction.status === EscrowStatus.COMPLETED && businessId && isBuyer && (
            <div className="mt-6">
              <GlassCard className="p-6 space-y-4">
                <div>
                  <h3 className="text-lg font-yrdly-display font-semibold text-foreground">Review Your Experience</h3>
                  <p className="text-sm font-yrdly-body text-[var(--yrdly-label)]">
                    Help others by sharing your experience with this business
                  </p>
                </div>
                <div>
                  {userReview ? (
                    <div className="space-y-3 font-yrdly-body">
                      <div className="flex items-center space-x-2">
                        <div className="flex">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <Star
                              key={star}
                              className={`h-5 w-5 ${
                                star <= userReview.rating
                                  ? 'fill-yellow-400 text-yellow-400'
                                  : 'text-gray-600'
                              }`}
                            />
                          ))}
                        </div>
                        <span className="text-sm font-medium text-foreground">Your Rating</span>
                      </div>
                      {userReview.comment && (
                        <div className="mt-2">
                          <p className="text-sm text-[var(--yrdly-label)]">{userReview.comment}</p>
                        </div>
                      )}
                      <div className="flex items-center space-x-2 text-xs text-[var(--yrdly-label)]">
                        <CheckCircle className="h-4 w-4 text-green-500" />
                        <span>Review submitted on {new Date(userReview.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                  ) : (
                    <Button
                      className="w-full font-yrdly-body"
                      onClick={() =>
                        router.push(
                          `/transactions/${transactionId}/review?seller=${encodeURIComponent(transaction.seller?.name ?? '')}`
                        )
                      }
                    >
                      <Star className="mr-2 h-4 w-4" />
                      Write a Review
                    </Button>
                  )}
                </div>
              </GlassCard>
            </div>
          )}
        </div>
      </div>
    </div>
  </div>
  );
}

