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

  const handleMessageUser = () => {
    if (!transaction) return;
    
    const otherUserId = user?.id === transaction.buyer_id 
      ? transaction.seller_id 
      : transaction.buyer_id;
    
    router.push(`/messages?user=${otherUserId}&item=${transaction.item_id}`);
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
      <Badge className={`${config.color} text-foreground`}>
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
              className="w-full"
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
              className="w-full"
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
              className="w-full"
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
      <div className="min-h-[100dvh] bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading transaction details...</p>
        </div>
      </div>
    );
  }

  if (!transaction) {
    return (
      <div className="min-h-[100dvh] bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="text-center p-6 space-y-4">
            <AlertTriangle className="h-12 w-12 text-orange-500 mx-auto" />
            <div>
              <h3 className="text-lg font-semibold mb-2">Transaction Not Found</h3>
              <p className="text-sm text-muted-foreground mb-4">
                {error || "The transaction you're looking for doesn't exist or you don't have access to it."}
              </p>
            </div>
            
            {error && error.includes('logged in') && (
              <Alert className="bg-blue-50 border-blue-200">
                <AlertDescription className="text-sm text-blue-800">
                  Please sign in to view your transaction details.
                </AlertDescription>
              </Alert>
            )}
            
            {error && error.includes('access') && (
              <Alert className="bg-yellow-50 border-yellow-200">
                <AlertDescription className="text-sm text-yellow-800">
                  This transaction may have been cancelled or deleted. Contact support if you believe this is an error.
                </AlertDescription>
              </Alert>
            )}
            
            <div className="flex flex-col gap-2">
              {retryCount < 3 && (
                <Button 
                  onClick={() => {
                    setRetryCount(prev => prev + 1);
                    setLoading(true);
                    fetchTransactionDetails();
                  }}
                  variant="outline"
                >
                  Try Again
                </Button>
              )}
              <Button onClick={() => router.push('/marketplace')} variant="default">
                Back to Marketplace
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isBuyer = user?.id === transaction.buyer_id;
  const otherUser = isBuyer ? transaction.seller : transaction.buyer;

  return (
    <div className="min-h-[100dvh] bg-background p-4">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Transaction Details</h1>
            <p className="text-muted-foreground">Transaction ID: {transaction.id}</p>
          </div>
          {getStatusBadge(transaction.status)}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Item Details */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                Item Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-4">
                <div className="w-20 h-20 relative rounded-lg overflow-hidden">
                  <Image
                    src={transaction.item.image_urls?.[0] || "/placeholder.svg"}
                    alt={transaction.item.title || transaction.item.text || "Item"} fill sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                    className="object-cover"
                  />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold">
                    {transaction.item.title || transaction.item.text || "Untitled Item"}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {transaction.item.description || transaction.item.text}
                  </p>
                  <p className="text-lg font-bold text-primary mt-2">
                    ₦{transaction.amount.toLocaleString()}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Transaction Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                Payment Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Item Price:</span>
                <span>₦{transaction.amount.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Platform Fee (3%):</span>
                <span>₦{transaction.commission.toLocaleString()}</span>
              </div>
              <Separator />
              <div className="flex justify-between">
                <span className="text-muted-foreground">Seller Receives:</span>
                <span className="font-semibold">₦{transaction.seller_amount.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-lg font-bold">
                <span>You Paid:</span>
                <span className="text-primary">₦{transaction.amount.toLocaleString()}</span>
              </div>
            </CardContent>
          </Card>

          {/* User Information */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                {isBuyer ? 'Seller' : 'Buyer'} Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <Avatar className="h-12 w-12">
                  <AvatarImage src={otherUser.avatar_url || "/placeholder.svg"} />
                  <AvatarFallback>
                    {otherUser.name?.slice(0, 2).toUpperCase() || "U"}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h3 className="font-semibold">{otherUser.name}</h3>
                  <p className="text-sm text-muted-foreground">{otherUser.email}</p>
                </div>
              </div>
              <Button 
                onClick={handleMessageUser}
                variant="outline" 
                className="w-full"
              >
                <MessageCircle className="mr-2 h-4 w-4" />
                Message {isBuyer ? 'Seller' : 'Buyer'}
              </Button>
            </CardContent>
          </Card>

          {/* Delivery Information */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Truck className="h-5 w-5" />
                Delivery Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Method:</span>
                <span>{getDeliveryMethodText(transaction.delivery_details)}</span>
              </div>
              {transaction.delivery_details.notes && (
                <div>
                  <span className="text-muted-foreground">Notes:</span>
                  <p className="text-sm mt-1">{transaction.delivery_details.notes}</p>
                </div>
              )}
              <Alert>
                <MessageCircle className="h-4 w-4" />
                <AlertDescription>
                  Discuss delivery details with the {isBuyer ? 'seller' : 'buyer'} via chat.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </div>

        {/* Transaction Timeline */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Transaction Timeline
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                <div>
                  <p className="font-medium">Transaction Created</p>
                  <p className="text-sm text-muted-foreground">
                    {new Date(transaction.created_at).toLocaleString()}
                  </p>
                </div>
              </div>
              
              {transaction.paid_at && (
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                  <div>
                    <p className="font-medium">Payment Confirmed</p>
                    <p className="text-sm text-muted-foreground">
                      {new Date(transaction.paid_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              )}
              
              {transaction.shipped_at && (
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 bg-purple-500 rounded-full"></div>
                  <div>
                    <p className="font-medium">Item Shipped</p>
                    <p className="text-sm text-muted-foreground">
                      {new Date(transaction.shipped_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              )}
              
              {transaction.delivered_at && (
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                  <div>
                    <p className="font-medium">Delivery Confirmed</p>
                    <p className="text-sm text-muted-foreground">
                      {new Date(transaction.delivered_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              )}
              
              {transaction.completed_at && (
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 bg-green-600 rounded-full"></div>
                  <div>
                    <p className="font-medium">Transaction Completed</p>
                    <p className="text-sm text-muted-foreground">
                      {new Date(transaction.completed_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Action Buttons */}
        <div className="flex flex-col gap-4">
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
                className="border-red-500 text-red-500 hover:bg-red-50"
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
              <Card className="border-blue-200 dark:border-blue-800">
                <CardHeader>
                  <CardTitle className="text-lg">Review Your Experience</CardTitle>
                  <CardDescription>
                    Help others by sharing your experience with this business
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {userReview ? (
                    <div className="space-y-3">
                      <div className="flex items-center space-x-2">
                        <div className="flex">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <Star
                              key={star}
                              className={`h-5 w-5 ${
                                star <= userReview.rating
                                  ? 'fill-yellow-400 text-yellow-400'
                                  : 'text-gray-300'
                              }`}
                            />
                          ))}
                        </div>
                        <span className="text-sm font-medium">Your Rating</span>
                      </div>
                      {userReview.comment && (
                        <div className="mt-2">
                          <p className="text-sm text-muted-foreground">{userReview.comment}</p>
                        </div>
                      )}
                      <div className="flex items-center space-x-2 text-xs text-muted-foreground">
                        <CheckCircle className="h-4 w-4 text-green-500" />
                        <span>Review submitted on {new Date(userReview.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                  ) : (
                    <Button
                      className="w-full"
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
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
