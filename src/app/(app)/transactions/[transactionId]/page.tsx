"use client";

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-supabase-auth';
import { TransactionStatusService } from '@/lib/transaction-status-service';
import { useToast } from '@/hooks/use-toast';
import { 
  CheckCircle, 
  Truck, 
  Package, 
  Clock, 
  AlertTriangle, 
  XCircle, 
  MessageCircle, 
  Star, 
  ArrowLeft,
  Check,
  Download,
  Loader2
} from 'lucide-react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/glass-card';
import { SupabaseChatService } from '@/lib/supabase-chat-service';
import { MARKETPLACE_CONSTANTS } from '@/lib/constants';
import { OpenDisputeDialog } from '@/components/disputes/OpenDisputeDialog';
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
  status: string;
  payment_method?: string;
  delivery_details?: any;
  created_at: string;
  paid_at?: string | null;
  shipped_at?: string | null;
  delivered_at?: string | null;
  completed_at?: string | null;
  dispute_reason?: string | null;
  buyer: {
    id: string;
    name: string;
    avatar_url?: string;
    email?: string;
  };
  seller: {
    id: string;
    name: string;
    avatar_url?: string;
    email?: string;
  };
  item: {
    id: string;
    title?: string;
    text?: string;
    description?: string;
    image_urls?: string[];
    image_url?: string;
    price: number;
    business_id?: string;
  };
}

const STATUS_ORDER = ['pending', 'paid', 'shipped', 'delivered', 'completed'];

const TIMELINE_STEPS = [
  { status: 'pending', label: 'Order created', key: 'created_at' },
  { status: 'paid', label: 'Payment confirmed', key: 'paid_at' },
  { status: 'shipped', label: 'Item sent / handed over', key: 'shipped_at' },
  { status: 'completed', label: 'Receipt confirmed', key: 'completed_at' },
];

export default function TransactionDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();

  const [tx, setTx] = useState<TransactionDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [userReview, setUserReview] = useState<any | null>(null);

  const transactionId = params.transactionId as string;

  const fetchTx = useCallback(async () => {
    try {
      const data = await TransactionStatusService.getTransactionDetails(transactionId);
      setTx(data);

      if (user && user.id === data.buyer_id && data.status === 'completed') {
        const review = await ReviewService.getUserReviewForTransaction(user.id, transactionId);
        setUserReview(review);
      }

      // Auto-verify payment if landed on page while status is still PENDING
      if (user && user.id === data.buyer_id && (data.status === 'pending' || data.status === 'creating_escrow')) {
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
            setTx(updatedData);
          }
        } catch (verifyErr) {
          console.warn('[TransactionDetailsPage] Auto-verify check skipped:', verifyErr);
        }
      }
    } catch (error) {
      console.error('Error fetching transaction details:', error);
      toast({
        title: "Error",
        description: "Failed to load transaction details.",
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
    fetchTx();
  }, [user, fetchTx, router]);

  const handleMessageCounterparty = async () => {
    if (!tx || !user) return;
    try {
      setActionLoading(true);
      const isBuyer = user.id === tx.buyer_id;
      const counterpartyId = isBuyer ? tx.seller_id : tx.buyer_id;
      const itemTitle = tx.item?.title || tx.item?.text || tx.item?.description || 'Item Inquiry';
      const itemImage = tx.item?.image_urls?.[0] || tx.item?.image_url || '';
      const itemPrice = tx.item?.price || tx.amount;

      const chatId = await SupabaseChatService.getOrCreateChat(
        tx.item_id || tx.item?.id,
        tx.buyer_id,
        tx.seller_id,
        itemTitle,
        itemImage,
        itemPrice
      );

      router.push(`/messages/${chatId}`);
    } catch (error) {
      console.error('Error opening chat:', error);
      toast({
        title: 'Error',
        description: 'Failed to open chat.',
        variant: 'destructive',
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleMarkSent = async () => {
    if (!tx || !user) return;
    try {
      setActionLoading(true);
      await TransactionStatusService.confirmShipped(tx.id, user.id);
      toast({ title: 'Success', description: 'Transaction marked as sent.' });
      await fetchTx();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Failed to mark as sent.', variant: 'destructive' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleConfirmReceipt = async () => {
    if (!tx || !user) return;
    try {
      setActionLoading(true);
      await TransactionStatusService.confirmDelivered(tx.id, user.id);
      await TransactionStatusService.completeTransaction(tx.id);
      toast({ title: 'Success', description: 'Receipt confirmed! Funds released to seller.' });
      await fetchTx();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Failed to confirm receipt.', variant: 'destructive' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleClaimFunds = async () => {
    if (!tx || !user) return;
    try {
      setActionLoading(true);
      await TransactionStatusService.completeTransaction(tx.id);
      toast({ title: 'Success', description: 'Funds claimed successfully!' });
      await fetchTx();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Failed to claim funds.', variant: 'destructive' });
    } finally {
      setActionLoading(false);
    }
  };

  const getStatusMeta = (statusStr: string) => {
    const status = statusStr?.toLowerCase() || 'pending';
    const meta: Record<string, { label: string; color: string; icon: any }> = {
      pending: { label: 'Awaiting Payment', color: '#FFB648', icon: Clock },
      paid: { label: 'Paid — Awaiting Handover', color: '#00D26A', icon: Package },
      shipped: { label: 'Item Sent / Handed Over', color: '#64B5F6', icon: Truck },
      delivered: { label: 'Delivered', color: '#00D26A', icon: CheckCircle },
      completed: { label: 'Completed', color: '#00D26A', icon: CheckCircle },
      disputed: { label: 'Disputed', color: '#EF4444', icon: AlertTriangle },
      cancelled: { label: 'Cancelled', color: '#9CA3AF', icon: XCircle },
    };
    return meta[status] || meta.pending;
  };

  const formatPrice = (amount: number) => `₦${amount.toLocaleString()}`;

  const formatTs = (isoStr?: string | null) => {
    if (!isoStr) return null;
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return null;
      return d.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return null;
    }
  };

  if (loading || !tx) {
    return (
      <div className="min-h-[100dvh] bg-background text-foreground flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  const isBuyer = user?.id === tx.buyer_id;
  const isSeller = user?.id === tx.seller_id;
  const counterparty = isBuyer ? tx.seller : tx.buyer;
  const businessId = tx.item?.business_id;
  const statusStr = tx.status?.toLowerCase() || 'pending';
  const meta = getStatusMeta(statusStr);

  const imagesArr = Array.isArray(tx.item?.image_urls)
    ? tx.item.image_urls
    : tx.item?.image_url
    ? [tx.item.image_url]
    : [];
  const thumb = imagesArr[0] || '';

  const currentStepIndex = STATUS_ORDER.indexOf(statusStr);

  const canMarkSent = isSeller && statusStr === 'paid';
  const canConfirmReceipt = isBuyer && (statusStr === 'shipped' || statusStr === 'delivered');

  const shippedTime = tx.shipped_at ? new Date(tx.shipped_at).getTime() : 0;
  const hoursSinceShipped = (Date.now() - shippedTime) / (1000 * 60 * 60);
  const canClaimFunds =
    isSeller &&
    (statusStr === 'shipped' || statusStr === 'delivered') &&
    hoursSinceShipped >= MARKETPLACE_CONSTANTS.AUTO_RELEASE_HOURS;

  const canDispute = (isBuyer || isSeller) && ['paid', 'shipped', 'delivered'].includes(statusStr);
  const canReview = isBuyer && statusStr === 'completed';

  const StatusIconComponent = meta.icon;

  return (
    <div className="min-h-[100dvh] bg-background text-foreground font-sans">
      {/* Header */}
      <div className="sticky top-[calc(4rem+env(safe-area-inset-top))] md:top-[calc(84px+env(safe-area-inset-top))] z-40 flex items-center gap-3 px-4 py-4 bg-card border-b border-border shadow-sm">
        <button
          onClick={() => router.back()}
          className="p-2 -ml-2 rounded-xl bg-muted/50 hover:bg-muted transition-colors border border-border"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5 text-foreground" />
        </button>
        <h1 className="font-sans font-bold text-xl text-foreground">Transaction</h1>
      </div>

      <div className="max-w-xl mx-auto px-4 py-4 space-y-4">
        {/* Status Banner */}
        <div
          className="p-4 rounded-2xl border flex items-center gap-3.5"
          style={{
            borderColor: `${meta.color}50`,
            backgroundColor: `${meta.color}10`,
          }}
        >
          <div
            className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: `${meta.color}20` }}
          >
            <StatusIconComponent className="w-5 h-5" style={{ color: meta.color }} />
          </div>
          <div>
            <h2 className="font-bold text-base" style={{ color: meta.color }}>
              {meta.label}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Transaction #{tx.id.slice(0, 8).toUpperCase()}
            </p>
          </div>
        </div>

        {/* Item Card */}
        <div className="p-4 rounded-2xl bg-card border border-border space-y-3">
          <div className="flex items-center gap-3.5">
            <div className="w-16 h-16 rounded-xl bg-muted flex-shrink-0 overflow-hidden relative border border-border/40">
              {thumb ? (
                <Image src={thumb} alt={tx.item?.title || 'Item'} fill className="object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                  <Package className="w-6 h-6" />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-base text-foreground truncate">
                {tx.item?.title || tx.item?.text || 'Item'}
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                ID: {tx.id.slice(0, 8)}…
              </p>
            </div>
          </div>

          <div className="h-px bg-border" />

          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between items-center text-muted-foreground">
              <span>Item price</span>
              <span className="font-bold text-foreground">{formatPrice(tx.amount)}</span>
            </div>
            {isSeller && (
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">You&apos;ll receive</span>
                <span className="font-bold text-[#00D26A]">
                  {formatPrice(tx.seller_amount || tx.amount - tx.commission)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Counterparty Card */}
        <div className="p-4 rounded-2xl bg-card border border-border space-y-3">
          <h4 className="font-bold text-xs uppercase text-muted-foreground tracking-wider">
            {isBuyer ? 'Seller' : 'Buyer'}
          </h4>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center font-bold text-primary text-sm">
                {counterparty?.name?.[0]?.toUpperCase() || 'U'}
              </div>
              <div>
                <p className="font-bold text-sm text-foreground">
                  {counterparty?.name || 'User'}
                </p>
                {counterparty?.email && (
                  <p className="text-xs text-muted-foreground">{counterparty.email}</p>
                )}
              </div>
            </div>
            <Button
              onClick={handleMessageCounterparty}
              disabled={actionLoading}
              size="sm"
              className="h-9 px-3.5 rounded-xl font-bold bg-primary text-primary-foreground hover:bg-primary/90 text-xs flex items-center gap-1.5"
            >
              {actionLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <MessageCircle className="w-3.5 h-3.5" />
              )}
              Message
            </Button>
          </div>
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
                  {new Date(tx.created_at).toLocaleString()}
                </p>
              </div>
            </div>
            
            {tx.paid_at && (
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                <div>
                  <p className="font-medium text-foreground">Payment Confirmed</p>
                  <p className="text-sm text-[var(--yrdly-label)]">
                    {new Date(tx.paid_at).toLocaleString()}
                  </p>
                </div>
              </div>
            )}
            
            {tx.shipped_at && (
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 bg-purple-500 rounded-full"></div>
                <div>
                  <p className="font-medium text-foreground">Item Shipped</p>
                  <p className="text-sm text-[var(--yrdly-label)]">
                    {new Date(tx.shipped_at).toLocaleString()}
                  </p>
                </div>
              </div>
            )}
            
            {tx.delivered_at && (
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                <div>
                  <p className="font-medium text-foreground">Delivery Confirmed</p>
                  <p className="text-sm text-[var(--yrdly-label)]">
                    {new Date(tx.delivered_at).toLocaleString()}
                  </p>
                </div>
              </div>
            )}
            
            {tx.completed_at && (
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 bg-green-600 rounded-full"></div>
                <div>
                  <p className="font-medium text-foreground">Transaction Completed</p>
                  <p className="text-sm text-[var(--yrdly-label)]">
                    {new Date(tx.completed_at).toLocaleString()}
                  </p>
                </div>
              </div>
            )}
          </div>
        </GlassCard>

        {/* Action Buttons */}
        <div className="flex flex-col gap-3 font-sans">
          {canMarkSent && (
            <Button
              onClick={handleMarkSent}
              disabled={actionLoading}
              className="w-full h-12 rounded-xl font-bold bg-primary text-primary-foreground hover:bg-primary/90 text-sm flex items-center justify-center gap-2"
            >
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />}
              I&apos;ve Sent the Item
            </Button>
          )}

          {canConfirmReceipt && (
            <Button
              onClick={handleConfirmReceipt}
              disabled={actionLoading}
              className="w-full h-12 rounded-xl font-bold bg-[#00D26A] text-white hover:bg-[#00D26A]/90 text-sm flex items-center justify-center gap-2"
            >
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              Confirm Receipt & Release Funds
            </Button>
          )}

          {canClaimFunds && (
            <Button
              onClick={handleClaimFunds}
              disabled={actionLoading}
              className="w-full h-12 rounded-xl font-bold bg-[#00D26A] text-white hover:bg-[#00D26A]/90 text-sm flex items-center justify-center gap-2"
            >
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Claim Funds
            </Button>
          )}

          {canDispute && (
            <Button
              onClick={() => router.push(`/transactions/${transactionId}/dispute`)}
              variant="outline"
              className="w-full h-11 rounded-xl font-bold border-red-500/40 text-red-500 hover:bg-red-500/10 text-xs flex items-center justify-center gap-2"
            >
              <AlertTriangle className="w-4 h-4" />
              Report an Issue / Dispute
            </Button>
          )}
        </div>
          
          {/* Review Section - Only for completed transactions linked to a business */}
          {statusStr === 'completed' && businessId && isBuyer && (
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
                          `/transactions/${transactionId}/review?seller=${encodeURIComponent(counterparty?.name ?? '')}`
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
  );
}

