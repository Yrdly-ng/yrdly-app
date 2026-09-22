"use client";

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-supabase-auth';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Wallet, Building2, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

export default function WithdrawPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();

  const [step, setStep] = useState<'amount' | 'confirm' | 'success'>('amount');
  const [balance, setBalance] = useState(0);
  const [bankInfo, setBankInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState('');
  const [confirming, setConfirming] = useState(false);

  const numAmount = Number(amount) || 0;

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const authHeaders: Record<string, string> = session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};

      const [txRes, payoutRes, bankRes] = await Promise.all([
        supabase
          .from('escrow_transactions')
          .select('seller_amount, status')
          .eq('seller_id', user.id),
        supabase.from('payout_requests').select('amount, status').eq('seller_id', user.id),
        fetch('/api/seller/setup-account', { headers: authHeaders }).then(r => r.ok ? r.json() : { account: null }).catch(() => ({ account: null })),
      ]);

      const txs = txRes.data ?? [];
      const pyts = payoutRes.data ?? [];

      const earned = txs
        .filter((t: any) => t.status === 'completed')
        .reduce((sum: number, t: any) => sum + (t.seller_amount ?? 0), 0);
      const paidOut = pyts
        .filter((p: any) => ['pending', 'processing', 'completed'].includes(p.status))
        .reduce((sum: number, p: any) => sum + (p.amount ?? 0), 0);

      setBalance(Math.max(0, earned - paidOut));

      if (bankRes.account) {
        setBankInfo(bankRes.account);
      }
    } catch (e) {
      console.error(e);
      toast({
        title: "Error",
        description: "Failed to load wallet balance details.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [user, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const [previewing, setPreviewing] = useState(false);
  const [previewData, setPreviewData] = useState<{
    amount: number;
    fee: number;
    totalDebit: number;
    netToBank: number;
  } | null>(null);

  const handleContinue = async () => {
    if (numAmount <= 0 || numAmount > balance) {
      toast({
        title: "Invalid Amount",
        description: "Please enter an amount within your available balance.",
        variant: "destructive",
      });
      return;
    }

    setPreviewing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/seller/payouts/preview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ amount: numAmount }),
      });

      const resData = await res.json();

      if (!res.ok || !resData.success) {
        const displayMsg = resData.reason || resData.message || resData.error || 'Failed to preview withdrawal';
        throw new Error(displayMsg);
      }

      setPreviewData({
        amount: resData.amount ?? numAmount,
        fee: resData.fee ?? 0,
        totalDebit: resData.totalDebit ?? numAmount,
        netToBank: resData.netToBank ?? numAmount,
      });
      setStep('confirm');
    } catch (e: any) {
      toast({
        title: "Withdrawal Preview Failed",
        description: e.message || "Failed to preview withdrawal",
        variant: "destructive",
      });
    } finally {
      setPreviewing(false);
    }
  };

  const handleWithdraw = async () => {
    if (numAmount <= 0 || numAmount > balance) {
      toast({
        title: "Invalid Amount",
        description: "Please enter an amount within your available balance.",
        variant: "destructive",
      });
      return;
    }
    setConfirming(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/seller/payouts/request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ amount: numAmount }),
      });

      if (!res.ok) {
        const errData = await res.json();
        const displayMsg = errData.reason || errData.message || errData.error || 'Failed to request withdrawal';
        throw new Error(displayMsg);
      }

      setStep('success');
      toast({
        title: "Withdrawal Successful",
        description: "Your payout request has been processed.",
      });
    } catch (e: any) {
      toast({
        title: "Withdrawal Cannot Be Processed",
        description: e.message || "Failed to request withdrawal",
        variant: "destructive",
      });
      setStep('amount');
    } finally {
      setConfirming(false);
    }
  };

  if (loading) {
    return (
      <div className="container max-w-2xl py-6 space-y-6 font-yrdly-body text-foreground">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (step === 'success') {
    return (
      <div className="container max-w-md py-12 text-center space-y-6 font-yrdly-body text-foreground">
        <div className="inline-flex p-4 rounded-full bg-emerald-500/10 text-emerald-500">
          <CheckCircle2 className="h-12 w-12" />
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-bold font-yrdly-display text-foreground">Withdrawal Submitted!</h2>
          <p className="text-[var(--yrdly-label)] text-sm">
            Your withdrawal of ₦{numAmount.toLocaleString()} has been processed. Funds will be transferred to your registered bank account.
          </p>
        </div>
        <Button className="w-full" onClick={() => router.push('/profile')}>
          Back to Profile
        </Button>
      </div>
    );
  }

  return (
    <div className="container max-w-2xl py-6 space-y-6 font-yrdly-body text-foreground">
      <div className="flex items-center space-x-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-2xl font-bold tracking-tight font-yrdly-display text-foreground">Withdraw Funds</h1>
      </div>

      <Card className="border border-[var(--yrdly-glass-border)] bg-[var(--yrdly-glass-bg)] backdrop-blur-xl shadow-lg">
        <CardHeader>
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <Wallet className="h-6 w-6" />
            </div>
            <div>
              <CardTitle className="font-yrdly-display text-foreground">Available Balance</CardTitle>
              <CardDescription className="text-[var(--yrdly-label)]">Withdraw funds to your registered bank account</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-background/50 p-4 rounded-lg border border-[var(--yrdly-glass-border)]">
            <p className="text-xs text-[var(--yrdly-label)] font-medium uppercase tracking-wider">Available For Withdrawal</p>
            <p className="text-3xl font-extrabold text-foreground font-yrdly-display mt-1">
              ₦{balance.toLocaleString()}
            </p>
          </div>

          {!bankInfo ? (
            <div className="flex items-start space-x-3 p-4 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-500">
              <AlertCircle className="h-5 w-5 mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">Bank Account Required</p>
                <p className="text-xs text-[var(--yrdly-label)]">
                  You must link a payout bank account before making withdrawals.
                </p>
                <Button variant="outline" size="sm" className="mt-2 border-[var(--yrdly-glass-border)] bg-background/50" onClick={() => router.push('/profile/payout-settings')}>
                  Setup Bank Account
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between p-3 rounded-lg border border-[var(--yrdly-glass-border)] bg-background/50">
              <div className="flex items-center space-x-3">
                <Building2 className="h-5 w-5 text-primary" />
                <div>
                  <p className="text-sm font-medium text-foreground">{bankInfo.bank_name || 'Bank Account'}</p>
                  <p className="text-xs text-[var(--yrdly-label)]">{bankInfo.account_number} • {bankInfo.account_name}</p>
                </div>
              </div>
            </div>
          )}

          {step === 'amount' && bankInfo && (
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label htmlFor="withdraw-amount" className="text-foreground">Amount (₦)</Label>
                <Input
                  id="withdraw-amount"
                  type="number"
                  placeholder="Enter amount"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  max={balance}
                  min={100}
                  className="border-[var(--yrdly-glass-border)] bg-background/50 text-foreground"
                />
              </div>
              <Button
                className="w-full"
                onClick={handleContinue}
                disabled={previewing || numAmount <= 0 || numAmount > balance}
              >
                {previewing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Continue
              </Button>
            </div>
          )}

          {step === 'confirm' && (
            <div className="space-y-4 pt-2 border-t border-[var(--yrdly-glass-border)]">
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">Confirm Withdrawal Details</p>
                <div className="flex justify-between text-sm py-1 border-b border-[var(--yrdly-glass-border)]">
                  <span className="text-[var(--yrdly-label)]">Amount to withdraw:</span>
                  <span className="font-semibold text-foreground">₦{numAmount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm py-1 border-b border-[var(--yrdly-glass-border)]">
                  <span className="text-[var(--yrdly-label)]">Payluk fee (incl. VAT):</span>
                  <span className="font-semibold text-amber-500">₦{(previewData?.fee ?? 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm py-1 border-b border-[var(--yrdly-glass-border)]">
                  <span className="text-[var(--yrdly-label)]">Total deducted from balance:</span>
                  <span className="font-bold text-foreground">₦{(previewData?.totalDebit ?? numAmount).toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm py-1 border-b border-[var(--yrdly-glass-border)]">
                  <span className="text-[var(--yrdly-label)]">Amount sent to bank:</span>
                  <span className="font-bold text-emerald-500">₦{(previewData?.netToBank ?? numAmount).toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm py-1 border-b border-[var(--yrdly-glass-border)]">
                  <span className="text-[var(--yrdly-label)]">Payout Bank:</span>
                  <span className="text-foreground">{bankInfo?.bank_name} ({bankInfo?.account_number})</span>
                </div>
              </div>
              <div className="flex space-x-3">
                <Button variant="outline" className="w-1/2 border-[var(--yrdly-glass-border)] bg-background/50" onClick={() => setStep('amount')}>
                  Back
                </Button>
                <Button className="w-1/2" onClick={handleWithdraw} disabled={confirming}>
                  {confirming ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Confirm Withdrawal
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
