"use client";

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/use-supabase-auth';
import { DisputeService, DisputeData } from '@/lib/dispute-service';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  AlertTriangle, 
  Calendar, 
  Clock,
  CheckCircle,
  XCircle,
  Search,
  ArrowRight,
  Package,
  User,
  Store,
  ShieldAlert
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

export default function AdminDisputesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  
  const [disputes, setDisputes] = useState<DisputeData[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const limit = 20;

  const fetchDisputes = useCallback(async () => {
    try {
      setLoading(true);
      const { data, count } = await DisputeService.getDisputesByStatus(statusFilter, page, limit);
      setDisputes(data);
      setTotalCount(count);
    } catch (error) {
      console.error('Error fetching disputes:', error);
      toast({
        title: "Error",
        description: "Failed to load disputes.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [statusFilter, page, toast]);

  useEffect(() => {
    if (!user) {
      router.push('/signin');
      return;
    }

    fetchDisputes();
  }, [user, statusFilter, page, router, fetchDisputes]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, searchTerm]);

  const getStatusMeta = (status: string) => {
    const statusConfig = {
      'open': { color: 'bg-amber-500/10 text-amber-400 border-amber-500/30', label: 'Open', icon: Clock },
      'under_review': { color: 'bg-blue-500/10 text-blue-400 border-blue-500/30', label: 'Under Review', icon: AlertTriangle },
      'resolved': { color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30', label: 'Resolved', icon: CheckCircle },
      'closed': { color: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30', label: 'Closed', icon: XCircle },
    };

    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.open;
    const Icon = config.icon;
    
    return (
      <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${config.color}`}>
        <Icon className="w-3.5 h-3.5" />
        {config.label}
      </span>
    );
  };

  const getReasonText = (reason: string) => {
    const reasonMap: { [key: string]: string } = {
      'item_not_received': 'Item not received',
      'item_different': 'Item different from description',
      'item_damaged': 'Item arrived damaged',
      'seller_unresponsive': 'Seller not responding',
      'payment_issue': 'Payment issue',
      'delivery_issue': 'Delivery problem',
      'other': 'Other',
    };
    return reasonMap[reason] || reason;
  };

  const filteredDisputes = disputes.filter(dispute => {
    const title = dispute.transaction?.item?.title || dispute.transaction?.item?.text || '';
    const reason = dispute.dispute_reason || (dispute as any).disputeReason || '';
    const matchesSearch = searchTerm === '' || 
      title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      reason.toLowerCase().includes(searchTerm.toLowerCase());
    
    return matchesSearch;
  });

  const handleViewDispute = (disputeId: string) => {
    router.push(`/admin/disputes/${disputeId}`);
  };

  if (loading) {
    return (
      <div className="w-full max-w-6xl mx-auto p-3 sm:p-5 font-yrdly-body space-y-4">
        <div>
          <h1 className="text-2xl font-bold font-yrdly-display text-foreground">Dispute Resolution</h1>
          <p className="text-xs sm:text-sm text-[var(--yrdly-label)]">Manage and resolve transaction disputes</p>
        </div>
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-44 w-full rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-6xl mx-auto p-3 sm:p-5 font-yrdly-body space-y-5 text-foreground">
      {/* Title & Stats Grid */}
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold font-yrdly-display text-foreground flex items-center gap-2.5">
            <ShieldAlert className="w-7 h-7 text-primary" />
            Dispute Resolution
          </h1>
          <p className="text-xs sm:text-sm text-[var(--yrdly-label)] mt-0.5">
            Manage buyer & seller claims across marketplace and business catalog purchases
          </p>
        </div>

        {/* Summary Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="p-3.5 sm:p-4 rounded-2xl border border-amber-500/20 bg-amber-500/5 backdrop-blur-xl min-w-0">
            <p className="text-2xl font-extrabold text-amber-400 font-yrdly-display">
              {disputes.filter(d => d.status === 'open').length}
            </p>
            <p className="text-xs text-[var(--yrdly-label)] font-medium mt-0.5 whitespace-nowrap overflow-hidden text-ellipsis">Open Disputes</p>
          </div>
          <div className="p-3.5 sm:p-4 rounded-2xl border border-blue-500/20 bg-blue-500/5 backdrop-blur-xl min-w-0">
            <p className="text-2xl font-extrabold text-blue-400 font-yrdly-display">
              {disputes.filter(d => d.status === 'under_review').length}
            </p>
            <p className="text-xs text-[var(--yrdly-label)] font-medium mt-0.5 whitespace-nowrap overflow-hidden text-ellipsis">Under Review</p>
          </div>
          <div className="p-3.5 sm:p-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 backdrop-blur-xl min-w-0">
            <p className="text-2xl font-extrabold text-emerald-400 font-yrdly-display">
              {disputes.filter(d => d.status === 'resolved').length}
            </p>
            <p className="text-xs text-[var(--yrdly-label)] font-medium mt-0.5 whitespace-nowrap overflow-hidden text-ellipsis">Resolved</p>
          </div>
          <div className="p-3.5 sm:p-4 rounded-2xl border border-zinc-500/20 bg-zinc-500/5 backdrop-blur-xl min-w-0">
            <p className="text-2xl font-extrabold text-zinc-400 font-yrdly-display">
              {disputes.filter(d => d.status === 'closed').length}
            </p>
            <p className="text-xs text-[var(--yrdly-label)] font-medium mt-0.5 whitespace-nowrap overflow-hidden text-ellipsis">Closed</p>
          </div>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="p-3.5 rounded-2xl border border-[var(--yrdly-glass-border)] bg-[var(--yrdly-glass-bg)] backdrop-blur-xl shadow-sm flex flex-col md:flex-row gap-3 items-center justify-between">
        <div className="relative w-full md:flex-1 min-w-0">
          <Search className="absolute left-3.5 top-1/2 transform -translate-y-1/2 w-4 h-4 text-[var(--yrdly-label)]" />
          <Input
            placeholder="Search title or reason..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 h-10 rounded-xl border-[var(--yrdly-glass-border)] bg-background/40 text-foreground placeholder:text-[var(--yrdly-label)] text-xs sm:text-sm focus-visible:ring-primary/40 w-full"
          />
        </div>
        <div className="w-full md:w-44 shrink-0">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-10 rounded-xl border-[var(--yrdly-glass-border)] bg-background/40 text-foreground text-xs sm:text-sm">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="under_review">Under Review</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Disputes List */}
      {filteredDisputes.length === 0 ? (
        <Card className="border border-[var(--yrdly-glass-border)] bg-[var(--yrdly-glass-bg)] backdrop-blur-xl rounded-2xl">
          <CardContent className="text-center py-12 px-4">
            <AlertTriangle className="w-12 h-12 text-[var(--yrdly-label)] mx-auto mb-3 opacity-60" />
            <h3 className="text-base font-bold font-yrdly-display text-foreground mb-1">No Disputes Found</h3>
            <p className="text-xs sm:text-sm text-[var(--yrdly-label)] max-w-sm mx-auto">
              {searchTerm || statusFilter !== 'all' 
                ? 'No disputes match your active search or filter criteria.'
                : 'There are no active disputes requiring attention right now.'
              }
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3.5">
          {filteredDisputes.map((dispute) => {
            const rawReason = dispute.dispute_reason || (dispute as any).disputeReason || 'Dispute';
            const reasonText = getReasonText(rawReason);
            const rawTxId = dispute.transaction_id || (dispute as any).transactionId || dispute.id;
            const shortTxId = rawTxId.slice(0, 8).toUpperCase();
            const createdAt = dispute.created_at || (dispute as any).createdAt || new Date().toISOString();

            const item = dispute.transaction?.item;
            const images = (item as any)?.images || item?.image_urls || ((item as any)?.image_url ? [(item as any).image_url] : []);
            const thumb = images?.[0] || '';

            const buyerName = dispute.transaction?.buyer?.name || 'Buyer';
            const sellerName = dispute.transaction?.seller?.name || 'Seller';
            const amount = dispute.transaction?.amount || 0;

            return (
              <div 
                key={dispute.id} 
                className="p-4 rounded-2xl border border-[var(--yrdly-glass-border)] bg-[var(--yrdly-glass-bg)] backdrop-blur-xl shadow-sm transition-all hover:border-primary/40 space-y-3.5 overflow-hidden"
              >
                {/* Header Row: Status Badge + Tx ID + Review Button */}
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 shrink-0">
                    {getStatusMeta(dispute.status)}
                    <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md bg-muted/60 text-[var(--yrdly-label)] border border-border/40">
                      #{shortTxId}
                    </span>
                  </div>

                  <Button 
                    onClick={() => handleViewDispute(dispute.id)}
                    size="sm"
                    className="h-9 px-4 rounded-xl font-bold bg-primary text-primary-foreground hover:bg-primary/90 text-xs flex items-center gap-1.5 shadow-sm shrink-0 ml-auto"
                  >
                    Review Dispute
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                </div>

                {/* Main Row: Thumbnail + Item Details */}
                <div className="flex items-start gap-3.5 min-w-0">
                  <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl bg-muted/50 border border-border/40 shrink-0 overflow-hidden relative flex items-center justify-center">
                    {thumb ? (
                      <Image
                        src={thumb}
                        alt={item?.title || "Item"} 
                        fill 
                        className="object-cover"
                      />
                    ) : (
                      <Package className="w-6 h-6 text-muted-foreground" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-baseline justify-between gap-2 flex-wrap">
                      <h3 className="font-bold text-sm sm:text-base text-foreground font-yrdly-display line-clamp-1 min-w-0">
                        {item?.title || item?.text || "Item Inquiry / Purchase"}
                      </h3>
                      <span className="font-bold text-sm sm:text-base text-[#00D26A] shrink-0">
                        ₦{amount.toLocaleString()}
                      </span>
                    </div>

                    {/* Reason Banner */}
                    <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-start gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400 mt-0.5" />
                      <span className="break-words leading-relaxed min-w-0">
                        <strong className="font-semibold text-amber-200">Reason:</strong> {reasonText}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Footer Metadata Row */}
                <div className="pt-2.5 border-t border-border/40 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-[var(--yrdly-label)] w-full">
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Calendar className="w-3.5 h-3.5 shrink-0" />
                    <span>Opened {new Date(createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 sm:gap-3 min-w-0 max-w-full">
                    <div className="flex items-center gap-1 min-w-0">
                      <User className="w-3.5 h-3.5 text-primary shrink-0" />
                      <span className="text-[var(--yrdly-label)] shrink-0">Buyer:</span>
                      <strong className="text-foreground font-semibold truncate max-w-[120px] sm:max-w-[180px]">{buyerName}</strong>
                    </div>
                    <span className="text-muted-foreground hidden sm:inline">•</span>
                    <div className="flex items-center gap-1 min-w-0">
                      <Store className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                      <span className="text-[var(--yrdly-label)] shrink-0">Seller:</span>
                      <strong className="text-foreground font-semibold truncate max-w-[120px] sm:max-w-[180px]">{sellerName}</strong>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination Controls */}
      {totalCount > limit && (
        <div className="flex justify-between items-center pt-2">
          <span className="text-xs text-[var(--yrdly-label)]">
            Showing {(page - 1) * limit + 1}–{Math.min(page * limit, totalCount)} of {totalCount} disputes
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              className="h-8 rounded-lg text-xs"
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page * limit >= totalCount}
              onClick={() => setPage(p => p + 1)}
              className="h-8 rounded-lg text-xs"
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
