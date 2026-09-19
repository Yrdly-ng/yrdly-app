"use client";

import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/hooks/use-supabase-auth';
import { EscrowService } from '@/lib/escrow-service';
import { Skeleton } from '@/components/ui/skeleton';
import { Package, ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

type Tab = 'purchases' | 'sales';
type Filter = 'all' | 'active' | 'completed' | 'disputed' | 'cancelled';

const STATUS_MAP: Record<string, { label: string; color: string; icon: string }> = {
  pending: { label: 'IN ESCROW', color: '#FFB648', icon: '🔒' },
  paid: { label: 'IN ESCROW', color: '#FFB648', icon: '🔒' },
  shipped: { label: 'SHIPPED', color: '#64B5F6', icon: '📦' },
  delivered: { label: 'DELIVERED', color: '#00D26A', icon: '✅' },
  completed: { label: 'COMPLETED', color: '#00D26A', icon: '✅' },
  disputed: { label: 'DISPUTED', color: '#f59e0b', icon: '⚠️' },
  cancelled: { label: 'CANCELLED', color: '#ef4444', icon: '✖️' },
  failed: { label: 'FAILED', color: '#ef4444', icon: '✖️' },
};

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'completed', label: 'Completed' },
  { key: 'disputed', label: 'Disputed' },
  { key: 'cancelled', label: 'Cancelled' },
];

export default function TransactionsPage() {
  const router = useRouter();
  const { user } = useAuth();

  const [tab, setTab] = useState<Tab>('purchases');
  const [filter, setFilter] = useState<Filter>('all');
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadTransactions = useCallback(async () => {
    if (!user) return;
    setLoading(true);
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
        const [buyerTx, sellerTx] = await Promise.all([
          EscrowService.getUserTransactions(user.id),
          EscrowService.getSellerTransactions(user.id)
        ]);
        const allTx = [...buyerTx, ...sellerTx].sort((a: any, b: any) =>
          new Date(b.created_at || b.createdAt).getTime() - new Date(a.created_at || a.createdAt).getTime()
        );
        setTransactions(allTx);
      }
    } catch (error) {
      console.error('Failed to load transactions:', error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      loadTransactions();
    }
  }, [user, loadTransactions]);

  const roleFilteredData = transactions.filter((tx) => {
    const buyerId = tx.buyerId || tx.buyer_id;
    const sellerId = tx.sellerId || tx.seller_id;
    if (tab === 'purchases') return buyerId === user?.id;
    return sellerId === user?.id;
  });

  const filteredData = roleFilteredData.filter((tx) => {
    const status = tx.status?.toLowerCase();
    if (filter === 'all') return true;
    if (filter === 'active') return status === 'pending' || status === 'paid' || status === 'shipped';
    if (filter === 'completed') return status === 'completed' || status === 'delivered';
    if (filter === 'disputed') return status === 'disputed';
    if (filter === 'cancelled') return status === 'cancelled' || status === 'failed';
    return true;
  });

  const formatPrice = (price: any) => {
    const num = typeof price === 'number' ? price : (parseFloat(price) || 0);
    return `₦${num.toLocaleString()}`;
  };

  const formatDateStr = (dateVal: any) => {
    if (!dateVal) return '';
    try {
      const d = new Date(dateVal);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return '';
    }
  };

  if (!user) {
    return (
      <div className="min-h-[100dvh] bg-background text-foreground font-sans container mx-auto px-4 py-8">
        <div className="text-center py-12">
          <h1 className="text-2xl font-bold mb-2">Transactions</h1>
          <p className="text-muted-foreground">Please log in to view your transactions.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background text-foreground font-sans">
      {/* Mobile Sticky Header */}
      <div className="sticky top-[calc(4rem+env(safe-area-inset-top))] md:top-[calc(84px+env(safe-area-inset-top))] lg:top-0 z-40 flex items-center gap-3 px-4 py-4 bg-card border-b border-border shadow-sm">
        <button
          onClick={() => router.back()}
          className="p-2 -ml-2 rounded-xl bg-muted/50 hover:bg-muted transition-colors border border-border"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5 text-foreground" />
        </button>
        <div>
          <h1 className="font-sans font-bold text-xl text-foreground">Transactions</h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        {/* Role Segmented Tabs (purchases | sales) */}
        <div className="bg-muted/60 p-1 rounded-2xl flex gap-1 border border-border/40">
          {(['purchases', 'sales'] as Tab[]).map((t) => {
            const active = tab === t;
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-2.5 rounded-xl font-bold text-xs capitalize transition-all ${
                  active
                    ? 'bg-foreground text-background shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t}
              </button>
            );
          })}
        </div>

        {/* Filter Pills */}
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`px-4 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all border ${
                  active
                    ? 'bg-[#00D26A] text-black border-[#00D26A] font-bold'
                    : 'bg-card text-muted-foreground border-border hover:border-muted-foreground/30'
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        {/* List Content */}
        {loading ? (
          <div className="space-y-3 pt-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="p-4 rounded-2xl bg-card border border-border flex items-center gap-4">
                <Skeleton className="w-13 h-13 rounded-xl bg-muted flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4 bg-muted" />
                  <Skeleton className="h-3 w-1/2 bg-muted" />
                  <Skeleton className="h-3 w-1/3 bg-muted" />
                </div>
                <div className="space-y-2 text-right">
                  <Skeleton className="h-4 w-16 ml-auto bg-muted" />
                  <Skeleton className="h-5 w-20 ml-auto rounded-md bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredData.length === 0 ? (
          <div className="text-center py-16 space-y-2">
            <Package className="w-12 h-12 text-muted-foreground/40 mx-auto" />
            <h3 className="font-bold text-foreground text-base">No transactions</h3>
            <p className="text-sm text-muted-foreground">Nothing here yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredData.map((tx: any) => {
              const statusKey = tx.status?.toLowerCase() || 'pending';
              const meta = STATUS_MAP[statusKey] || STATUS_MAP.pending;
              const isBuyer = (tx.buyerId || tx.buyer_id) === user?.id;
              const counterparty = isBuyer ? tx.seller : tx.buyer;
              const imagesArr = Array.isArray(tx.item?.images || tx.item?.image_urls)
                ? (tx.item?.images || tx.item?.image_urls)
                : typeof tx.item?.images === 'string'
                ? [tx.item.images]
                : [];
              const thumb = imagesArr[0] || tx.item?.image_url || '';
              const dateStr = formatDateStr(tx.created_at || tx.createdAt);
              const title = tx.item?.title || tx.item?.text || tx.item_title || 'Item';
              const counterpartyName = counterparty?.name || 'User';

              return (
                <div
                  key={tx.id}
                  onClick={() => router.push(`/transactions/${tx.id}`)}
                  className="flex items-center gap-4 p-4 rounded-2xl bg-card border border-border/80 hover:border-primary/50 transition-all cursor-pointer shadow-sm active:scale-[0.99]"
                >
                  {/* Thumbnail */}
                  <div className="w-[52px] h-[52px] rounded-xl bg-muted flex-shrink-0 overflow-hidden relative border border-border/40">
                    {thumb ? (
                      <Image
                        src={thumb}
                        alt={title}
                        fill
                        className="object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                        <Package className="w-6 h-6" />
                      </div>
                    )}
                  </div>

                  {/* Middle Info */}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-sm text-foreground truncate">
                      {title}
                    </h3>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {counterpartyName}
                    </p>
                    <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                      {dateStr}
                    </p>
                  </div>

                  {/* Right Amount & Status */}
                  <div className="text-right flex flex-col items-end gap-1.5 flex-shrink-0">
                    <span className="font-bold text-sm text-foreground">
                      {formatPrice(tx.amount)}
                    </span>
                    <div
                      className="inline-flex items-center px-2 py-0.5 rounded-lg border text-[10px] font-bold tracking-wider"
                      style={{
                        backgroundColor: `${meta.color}18`,
                        borderColor: `${meta.color}35`,
                        color: meta.color,
                      }}
                    >
                      <span className="mr-1 text-[9px]">{meta.icon}</span>
                      {meta.label}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}


