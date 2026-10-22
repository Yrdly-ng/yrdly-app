'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, XCircle, Clock3, Printer, RotateCw } from 'lucide-react';
import { AppHeader } from '@/components/layout/AppHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/use-supabase-auth';
import { authenticatedFetch } from '@/lib/auth/authenticated-fetch';
import { formatPayoutDate, type PayoutReceipt } from '@/lib/payments/payout-receipt';

const money = (value: number) => new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(value);
export default function PayoutReceiptPage() {
  const { payoutId } = useParams<{ payoutId: string }>();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [payout, setPayout] = useState<PayoutReceipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError(null); setPayout(null);
    try {
      const result = await authenticatedFetch<{ payout: PayoutReceipt }>(`/api/seller/payouts/${encodeURIComponent(payoutId)}`, {}, 'GET');
      setPayout(result.payout);
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not load receipt'); }
    finally { setLoading(false); }
  }, [payoutId]);
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace(`/login?redirect=${encodeURIComponent(`/profile/payouts/${payoutId}`)}`); return; }
    void load();
  }, [authLoading, user, router, payoutId, load]);

  const completed = payout?.status === 'completed';
  const failed = payout?.status === 'failed' || payout?.status === 'cancelled';
  const title = completed ? 'Withdrawal successful' : failed ? `Withdrawal ${payout?.status === 'cancelled' ? 'cancelled' : 'unsuccessful'}` : 'Withdrawal in progress';
  const Icon = completed ? CheckCircle2 : failed ? XCircle : Clock3;
  const fields = payout ? [
    ['Status', completed ? 'Successful' : payout.status === 'failed' ? 'Failed' : payout.status === 'cancelled' ? 'Cancelled' : payout.status === 'pending' ? 'Pending' : 'Processing'],
    ['Requested', formatPayoutDate(payout.requestedAt)],
    ...(payout.processedAt ? [[completed ? 'Completed' : 'Last updated', formatPayoutDate(payout.processedAt)]] : []),
    ['Bank', payout.bankName || 'Not recorded'],
    ...(payout.accountNumber ? [['Account number', payout.accountNumber]] : []),
    ...(payout.accountName ? [['Account name', payout.accountName]] : []),
    ['Withdrawal amount', money(payout.amount)],
    ...(payout.fee !== null ? [['Quoted transfer fee', money(payout.fee)]] : []),
    ...(payout.netAmount !== null ? [[completed ? 'Sent to bank' : 'Intended bank amount', money(payout.netAmount)]] : []),
    ...(payout.transactionReference ? [['Transfer reference', payout.transactionReference]] : []),
    ['Receipt ID', payout.id],
  ] : [];
  return (
    <div className="min-h-[100dvh] bg-background">
      <div className="print:hidden"><AppHeader title="Withdrawal receipt" onBack={() => router.push('/profile/payouts')} /></div>
      <main className="mx-auto max-w-xl px-4 py-6 sm:py-10">
        {loading ? <Skeleton className="h-[480px] rounded-2xl" aria-label="Loading withdrawal receipt" /> : error ? (
          <Card><CardContent className="space-y-4 p-6"><h1 className="text-xl font-semibold">Receipt unavailable</h1><p role="alert" className="text-muted-foreground">{error}</p><Button onClick={load}>Try again</Button><Link href="/profile/payouts" className="block text-primary underline">Back to payout history</Link></CardContent></Card>
        ) : payout ? (
          <>
            <Card className="overflow-hidden rounded-2xl print:border-0 print:shadow-none">
              <div className="border-b border-dashed px-6 py-8 text-center">
                <p className="mb-6 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">YRDLY · Withdrawal receipt</p>
                <Icon className={`mx-auto mb-4 h-12 w-12 ${completed ? 'text-emerald-600' : failed ? 'text-destructive' : 'text-amber-600'}`} aria-hidden="true" />
                <h1 className="text-xl font-semibold">{title}</h1>
                <p className="mt-3 text-3xl font-bold tracking-tight">{money(completed && payout.netAmount !== null ? payout.netAmount : payout.amount)}</p>
                <p className="mt-3 text-sm text-muted-foreground">{completed ? 'The transfer was confirmed successful.' : failed ? 'This receipt records an unsuccessful withdrawal. It is not proof of payment.' : 'The final transfer outcome has not been confirmed yet.'}</p>
              </div>
              <CardContent className="p-6">
                {failed && payout.failureReason ? <p className="mb-6 rounded-lg bg-destructive/10 p-3 text-sm text-destructive break-words">{payout.failureReason}</p> : null}
                <dl className="space-y-4">{fields.map(([label, value]) => <div key={label} className="flex flex-col gap-1 text-sm sm:flex-row sm:justify-between sm:gap-6"><dt className="shrink-0 text-muted-foreground">{label}</dt><dd className="min-w-0 break-words font-medium sm:text-right">{value}</dd></div>)}</dl>
                {!payout.bankName && !payout.accountNumber ? <p className="mt-6 border-t pt-4 text-xs text-muted-foreground">The bank destination was not recorded for this older withdrawal.</p> : null}
              </CardContent>
            </Card>
            <div className="mt-5 flex flex-wrap gap-3 print:hidden">
              <Button onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" />Print / save receipt</Button>
              <Button variant="outline" onClick={load}><RotateCw className="mr-2 h-4 w-4" />Refresh status</Button>
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}
