"use client";

import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/hooks/use-supabase-auth';
import { EscrowService } from '@/lib/escrow-service';
import { EscrowTransaction, EscrowStatus } from '@/types/escrow';
import { EscrowStatusDisplay } from '@/components/escrow/EscrowStatusDisplay';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Package, 
  CreditCard, 
  Truck, 
  CheckCircle, 
  Clock,
  AlertTriangle,
  XCircle,
  Loader2
} from 'lucide-react';
import { PAGINATION_CONSTANTS } from '@/lib/constants';

import { GlassCard } from '@/components/ui/glass-card';

export default function TransactionsPage() {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<EscrowTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [activeTab, setActiveTab] = useState('all');

  const loadTransactions = useCallback(async () => {
    if (!user) return;
    
    setIsLoading(true);
    try {
      const { supabase } = await import('@/lib/supabase');
      const { data: { session } } = await supabase.auth.getSession();
      
      const response = await fetch('/api/transactions', {
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {}),
        }
      });

      if (response.ok) {
        const data = await response.json();
        setTransactions(data);
      } else {
        // Fallback to direct client query if API route returns error
        const [buyerTransactions, sellerTransactions] = await Promise.all([
          EscrowService.getUserTransactions(user.id),
          EscrowService.getSellerTransactions(user.id)
        ]);
        const allTransactions = [...buyerTransactions, ...sellerTransactions]
          .sort((a, b) => new Date(b.createdAt || b.updatedAt).getTime() - new Date(a.createdAt || a.updatedAt).getTime());
        setTransactions(allTransactions);
      }
      setHasMore(false);
    } catch (error) {
      console.error('Failed to load transactions:', error);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      loadTransactions();
    }
  }, [user, loadTransactions]);

  const getFilteredTransactions = () => {
    if (activeTab === 'all') return transactions;
    return transactions.filter(t => t.status === activeTab);
  };

  const getStatusIcon = (status: EscrowStatus) => {
    switch (status) {
      case EscrowStatus.PENDING:
        return <Clock className="w-5 h-5 text-yellow-500" />;
      case EscrowStatus.PAID:
        return <CreditCard className="w-5 h-5 text-blue-500" />;
      case EscrowStatus.SHIPPED:
        return <Truck className="w-5 h-5 text-purple-500" />;
      case EscrowStatus.DELIVERED:
        return <Package className="w-5 h-5 text-indigo-500" />;
      case EscrowStatus.COMPLETED:
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case EscrowStatus.DISPUTED:
        return <AlertTriangle className="w-5 h-5 text-red-500" />;
      case EscrowStatus.CANCELLED:
        return <XCircle className="w-5 h-5 text-[var(--yrdly-label)]" />;
      default:
        return <Clock className="w-5 h-5 text-[var(--yrdly-label)]" />;
    }
  };

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-NG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(date));
  };

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: 'NGN',
      minimumFractionDigits: 0
    }).format(price);
  };

  const getRole = (transaction: EscrowTransaction) => {
    return user?.id === transaction.buyerId ? 'Buyer' : 'Seller';
  };

  if (!user) {
    return (
      <div className="min-h-[100dvh] bg-[var(--yrdly-dark)] text-foreground font-yrdly-body container mx-auto px-4 py-8">
        <div className="text-center">
          <h1 className="text-2xl font-yrdly-display font-bold text-foreground mb-4">Transactions</h1>
          <p className="font-yrdly-body text-[var(--yrdly-label)]">Please log in to view your transactions.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-[var(--yrdly-dark)] text-foreground font-yrdly-body container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-yrdly-display font-bold text-foreground mb-2">My Transactions</h1>
        <p className="font-yrdly-body text-[var(--yrdly-label)]">Track your marketplace purchases and sales</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-7 bg-[var(--yrdly-glass-bg)] border border-[var(--yrdly-glass-border)] text-[var(--yrdly-label)] font-yrdly-body">
          <TabsTrigger value="all" className="data-[state=active]:bg-primary/20 data-[state=active]:text-foreground">All</TabsTrigger>
          <TabsTrigger value={EscrowStatus.PENDING} className="data-[state=active]:bg-primary/20 data-[state=active]:text-foreground">Pending</TabsTrigger>
          <TabsTrigger value={EscrowStatus.PAID} className="data-[state=active]:bg-primary/20 data-[state=active]:text-foreground">Paid</TabsTrigger>
          <TabsTrigger value={EscrowStatus.SHIPPED} className="data-[state=active]:bg-primary/20 data-[state=active]:text-foreground">Shipped</TabsTrigger>
          <TabsTrigger value={EscrowStatus.DELIVERED} className="data-[state=active]:bg-primary/20 data-[state=active]:text-foreground">Delivered</TabsTrigger>
          <TabsTrigger value={EscrowStatus.COMPLETED} className="data-[state=active]:bg-primary/20 data-[state=active]:text-foreground">Completed</TabsTrigger>
          <TabsTrigger value={EscrowStatus.DISPUTED} className="data-[state=active]:bg-primary/20 data-[state=active]:text-foreground">Disputed</TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="space-y-4">
          {isLoading ? (
            <div className="grid gap-6">
              {[1, 2, 3].map(i => (
                <GlassCard key={i} className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3 w-1/2">
                      <Skeleton className="w-5 h-5 rounded-full bg-muted" />
                      <div className="w-full space-y-2">
                        <Skeleton className="h-6 w-3/4 bg-muted" />
                        <div className="flex items-center space-x-2">
                          <Skeleton className="h-5 w-16 bg-muted" />
                          <Skeleton className="h-5 w-20 bg-muted" />
                        </div>
                      </div>
                    </div>
                    <div className="text-right w-1/4 space-y-1">
                      <Skeleton className="h-8 w-24 ml-auto bg-muted" />
                      <Skeleton className="h-4 w-32 ml-auto bg-muted" />
                    </div>
                  </div>
                </GlassCard>
              ))}
            </div>
          ) : getFilteredTransactions().length === 0 ? (
            <GlassCard className="text-center py-12">
              <Package className="w-16 h-16 text-[var(--yrdly-label)] mx-auto mb-4 opacity-50" />
              <h3 className="text-lg font-yrdly-display font-medium text-foreground mb-2">No transactions found</h3>
              <p className="font-yrdly-body text-sm text-[var(--yrdly-label)]">
                {activeTab === 'all' 
                  ? "You haven't made any transactions yet."
                  : `No ${activeTab} transactions found.`
                }
              </p>
            </GlassCard>
          ) : (
            <div className="grid gap-6">
              {getFilteredTransactions().map((transaction) => (
                <GlassCard key={transaction.id} className="hover:border-[var(--yrdly-glass-border)]/80 transition-all p-6">
                  <div className="flex items-center justify-between border-b border-[var(--yrdly-glass-border)] pb-4 mb-4">
                    <div className="flex items-center space-x-3">
                      {getStatusIcon(transaction.status)}
                      <div>
                        <h3 className="text-lg font-yrdly-display font-bold text-foreground">
                          Transaction #{transaction.id.slice(-8)}
                        </h3>
                        <div className="flex items-center space-x-2 mt-1">
                          <Badge variant="outline" className="text-xs font-yrdly-body border-[var(--yrdly-glass-border)] text-[var(--yrdly-label)]">
                            {getRole(transaction)}
                          </Badge>
                          <EscrowStatusDisplay status={transaction.status} />
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-yrdly-display font-bold text-primary">
                        {formatPrice(transaction.amount)}
                      </div>
                      <div className="text-sm font-yrdly-body text-[var(--yrdly-label)]">
                        {getRole(transaction) === 'Buyer' 
                          ? `You paid ${formatPrice(transaction.amount)}`
                          : `You receive ${formatPrice(transaction.sellerAmount || (transaction.amount - transaction.commission))}`
                        }
                      </div>
                      <div className="text-xs font-yrdly-body text-[var(--yrdly-label)]/70">
                        {getRole(transaction) === 'Seller' && `-${formatPrice(transaction.commission)} platform fee`}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <h4 className="font-yrdly-display font-semibold text-foreground mb-2">Transaction Details</h4>
                      <div className="space-y-2 text-sm font-yrdly-body">
                        <div className="flex justify-between">
                          <span className="text-[var(--yrdly-label)]">Payment Method:</span>
                          <span className="capitalize text-foreground">{transaction.paymentMethod.replace('_', ' ')}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[var(--yrdly-label)]">Delivery:</span>
                          <span className="capitalize text-foreground">{transaction.deliveryDetails.option.replace('_', ' ')}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[var(--yrdly-label)]">Created:</span>
                          <span className="text-foreground">{formatDate(transaction.createdAt)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[var(--yrdly-label)]">Last Updated:</span>
                          <span className="text-foreground">{formatDate(transaction.updatedAt)}</span>
                        </div>
                      </div>
                    </div>

                    <div>
                      <h4 className="font-yrdly-display font-semibold text-foreground mb-2">Delivery Information</h4>
                      <div className="space-y-2 text-sm font-yrdly-body">
                        <div>
                          <span className="text-[var(--yrdly-label)]">Method:</span>
                          <p className="text-foreground">
                            {transaction.deliveryDetails.option === 'face_to_face' 
                              ? 'Face-to-Face Meetup' 
                              : 'Seller Delivery'}
                          </p>
                        </div>
                        {transaction.deliveryDetails.notes && (
                          <div>
                            <span className="text-[var(--yrdly-label)]">Notes:</span>
                            <p className="text-foreground">{transaction.deliveryDetails.notes}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {transaction.disputeReason && (
                    <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl font-yrdly-body">
                      <h4 className="font-yrdly-display font-medium text-red-400 mb-1">Dispute Reason</h4>
                      <p className="text-red-300 text-sm">{transaction.disputeReason}</p>
                    </div>
                  )}
                </GlassCard>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

