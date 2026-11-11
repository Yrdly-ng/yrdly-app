"use client";

import React, { useEffect, useState } from "react";
import { X, Lock, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useRouter } from "next/navigation";
import { MARKETPLACE_CONSTANTS } from "@/lib/shared/constants";
import { supabase } from "@/lib/supabase/supabase";


import { GlassCard } from "@/components/ui/glass-card";

/* ── Design tokens ─────────────────────────────────── */
const BG     = "var(--yrdly-dark)";
const CARD   = "var(--yrdly-glass-bg)";
const CARDH  = "var(--yrdly-glass-bg)";
const GREEN  = "hsl(var(--primary))";
const GREEN_L = "#82DB7E";
const MUTED  = "var(--yrdly-label)";
const DIM    = "var(--yrdly-label)";

interface BuyButtonProps {
  itemId: string;
  itemTitle: string;
  itemImageUrl?: string;
  price: number;
  condition?: string;
  sellerId: string;
  sellerName: string;
  itemType?: 'post' | 'catalog_item';
}

export function BuyButton({
  itemId,
  itemTitle,
  itemImageUrl,
  price,
  condition = "Used",
  sellerId,
  sellerName,
  itemType = 'post',
}: BuyButtonProps) {
  const { user }  = useAuth();
  const { toast } = useToast();
  const router    = useRouter();

  const [open, setOpen]         = useState(false);
  const [loading, setLoading]   = useState(false);
  const [pendingTransactionId, setPendingTransactionId] = useState<string | null>(null);
  const [checkingPending, setCheckingPending] = useState(false);
  const walletRecoveryAvailable = process.env.NEXT_PUBLIC_PAYLUK_WALLET_RECOVERY_ENABLED === 'true';
  // Store only the order UUID, never a Payluk token or customer identity.
  const pendingKey = user ? `yrdly:pending-checkout:${user.id}:${itemType}:${itemId}` : null;
  useEffect(() => {
    if (!pendingKey) { setPendingTransactionId(null); return; }
    try {
      const stored = window.localStorage.getItem(pendingKey);
      setPendingTransactionId(stored && /^[0-9a-f-]{36}$/i.test(stored) ? stored : null);
    } catch { setPendingTransactionId(null); }
  }, [pendingKey]);

  const savePending = (txId: string) => {
    setPendingTransactionId(txId);
    try { if (pendingKey) window.localStorage.setItem(pendingKey, txId); } catch { /* storage disabled */ }
  };
  const clearPending = () => {
    setPendingTransactionId(null);
    try { if (pendingKey) window.localStorage.removeItem(pendingKey); } catch { /* storage disabled */ }
  };

  const checkPendingPayment = async () => {
    if (!pendingTransactionId || !user || checkingPending) return;
    setCheckingPending(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Please log in again to check your payment.');
      const response = await fetch('/api/payment/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ txRef: pendingTransactionId }),
      });
      const result = await response.json();
      if (response.ok && result.success) {
        const confirmed = pendingTransactionId;
        clearPending();
        toast({ title: 'Payment confirmed', description: 'Your purchase is now linked to your order.' });
        router.push(`/transactions/${confirmed}`);
      } else if (response.status === 402) {
        toast({ title: 'Payment still processing', description: 'Your transfer may have been credited to Payluk. Contact support or use an available Payluk wallet option before transferring again.' });
      } else {
        toast({ title: 'Payment needs attention', description: result.error || 'Contact support before paying again.', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Unable to check payment', description: 'Your checkout is saved. Try again or contact support.', variant: 'destructive' });
    } finally { setCheckingPending(false); }
  };

  const commission = Math.round(price * MARKETPLACE_CONSTANTS.COMMISSION_RATE * 100) / 100;
  // Native commission is charged to the seller, not added to the buyer's total.
  const totalPay = price;

  const handleBuy = async (method: 'checkout' | 'wallet' = 'checkout') => {
    if (!user) {
      toast({ title: "Sign in required", description: "Please log in to purchase items.", variant: "destructive" });
      return;
    }
    if (user.id === sellerId) {
      toast({ title: "Not allowed", description: "You cannot buy your own item.", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      // Get current session token for auth
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast({ title: "Session expired", description: "Please log in again.", variant: "destructive" });
        return;
      }

      const res = await fetch("/api/payment/initialize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          itemId,
          buyerId: user.id,
          sellerId,
          price,
          buyerEmail: user.email ?? "",
          buyerName:
            user.user_metadata?.name ||
            user.email?.split("@")[0] ||
            "Buyer",
          itemTitle,
          sellerName,
          itemType,
        }),
      });

      const data = await res.json();

      if (!res.ok && data.error === 'PHONE_VERIFICATION_REQUIRED') {
        setOpen(false);
        const returnPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        toast({
          title: "Verify your phone number",
          description: "Verify your number to continue with payment, then return here to buy this item.",
          action: (
            <ToastAction
              altText="Verify your phone number"
              onClick={() => router.push(`/onboarding/verify-phone?next=${encodeURIComponent(returnPath)}`)}
            >
              Verify phone
            </ToastAction>
          ),
        });
        return;
      }

      if (!res.ok && data.error === 'SELLER_PHONE_UNVERIFIED') {
        toast({
          title: "Seller verification needed",
          description: data.message || "The seller needs to verify their phone number before you can buy this item. Please contact the seller.",
        });
        return;
      }

      if (!res.ok && data.error === 'BUYER_PAYMENT_IDENTITY_MISMATCH') {
        toast({
          title: "Payment account needs attention",
          description: data.message || "Contact Yrdly Support to reconcile your linked Payluk account before trying again.",
          variant: "destructive",
        });
        return;
      }

      if (!res.ok && data.error === 'SELLER_PAYMENT_IDENTITY_MISMATCH') {
        toast({
          title: "Seller payment account needs attention",
          description: data.message || "The seller needs to contact Yrdly Support before this item can be purchased.",
          variant: "destructive",
        });
        return;
      }

      if (res.ok && data.alreadyPaid && data.transactionId) {
        clearPending();
        router.push(`/transactions/${data.transactionId}`);
        return;
      }

      if (!res.ok || (!data.paylukPaymentToken && !data.paymentLink)) {
        console.error("[BuyButton] Payment initialization failed:", res.status, data);
        toast({
          title: "Payment Error",
          description: data.error || data.message || "Failed to initialize payment.",
          variant: "destructive",
        });
        return;
      }

      if (data.transactionId) savePending(data.transactionId);
      setOpen(false);

      if (method === 'wallet') {
        if (!data.transactionId) throw new Error('Checkout reference missing. Please try again.');
        const walletResponse = await fetch('/api/payment/pay-with-wallet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ transactionId: data.transactionId }),
        });
        const walletResult = await walletResponse.json();
        if (walletResponse.ok && walletResult.success) {
          clearPending();
          toast({ title: 'Payment confirmed', description: 'Your Payluk wallet has funded the purchase.' });
          router.push(`/transactions/${data.transactionId}`);
        } else if (walletResponse.status === 202) {
          toast({ title: 'Payment being verified', description: walletResult.message || 'Do not pay again. Check the saved transaction.' });
        } else {
          toast({ title: 'Wallet payment not completed', description: walletResult.error || 'Check your balance or contact support.', variant: 'destructive' });
        }
        return;
      }

      if (data.paylukPaymentToken) {
        try {
          const publicKey = process.env.NEXT_PUBLIC_PAYLUK_PUBLIC_KEY;
          if (!publicKey) {
            console.error('[BuyButton] NEXT_PUBLIC_PAYLUK_PUBLIC_KEY is missing in environment variables');
            toast({
              title: "Configuration Error",
              description: "Missing NEXT_PUBLIC_PAYLUK_PUBLIC_KEY in environment settings.",
              variant: "destructive",
            });
            return;
          }

          const { initEscrowCheckout, pay } = await import('payluk-escrow-inline-checkout');
          initEscrowCheckout({
            publicKey,
          });

          // Track whether payment callback already succeeded so onClose doesn't
          // fire a misleading "Payment Cancelled" toast after a real success.
          let paymentSucceeded = false;

          await pay({
            paymentToken: data.paylukPaymentToken,
            reference: data.transactionId,
            redirectUrl: `${window.location.origin}/transactions/${data.transactionId}`,
            brand: 'Yrdly',
            customerId: data.buyerPaylukId,
            callback: async (result: any) => {
              console.log('[BuyButton] Payluk callback result:', JSON.stringify(result));
              const statusLower = String(result?.status || result?.state || '').toLowerCase();
              const eventLower = String(result?.event || '').toLowerCase();
              const msgLower = String(result?.message || '').toLowerCase();

              const isSuccess =
                statusLower === 'success' ||
                statusLower === 'paid' ||
                statusLower === 'completed' ||
                statusLower === 'ongoing' ||
                statusLower === 'opened' ||
                eventLower.includes('ongoing') ||
                eventLower.includes('success') ||
                msgLower.includes('success') ||
                msgLower.includes('paid');

              if (isSuccess) {
                // An SDK callback is a signal to verify, never proof of settlement.
                try {
                  const verification = await fetch('/api/payment/verify', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': `Bearer ${session.access_token}`,
                    },
                    body: JSON.stringify({ txRef: data.transactionId }),
                  });
                  const verified = await verification.json();
                  if (verification.ok && verified.success) {
                    paymentSucceeded = true;
                    clearPending();
                    toast({ title: 'Payment Successful', description: 'Your purchase is confirmed.' });
                    router.push(`/transactions/${data.transactionId}`);
                  } else {
                    toast({ title: 'Payment still processing', description: 'Your checkout is saved. Check it after Payluk reconciliation.' });
                  }
                } catch (verifyErr) {
                  console.error('[BuyButton] Payment verification error:', verifyErr);
                  toast({ title: 'Verification pending', description: 'Your checkout is saved. Do not transfer again.' });
                }
              } else {
                console.warn('[BuyButton] Payluk callback with non-success result:', result);
              }
            },
            onClose: async () => {
              // Payluk fires onClose when modal closes.
              // If callback didn't flag success, verify with backend before showing "Cancelled"
              if (!paymentSucceeded) {
                try {
                  const verifyRes = await fetch('/api/payment/verify', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': `Bearer ${session.access_token}`,
                    },
                    body: JSON.stringify({ txRef: data.transactionId }),
                  });
                  const verifyData = await verifyRes.json();
                  if (verifyData?.success) {
                    paymentSucceeded = true;
                    clearPending();
                    toast({ title: "Payment Successful", description: "Your purchase is confirmed." });
                    router.push(`/transactions/${data.transactionId}`);
                    return;
                  }
                } catch (err) {
                  console.warn('[BuyButton] onClose verification check error:', err);
                }

                // Backgrounding the dialog does not cancel the remote escrow.
                toast({ title: 'Checkout saved', description: 'Your transfer may still be reconciling. Return to check or resume; do not transfer again.' });
              }
            },
          });
        } catch (sdkErr: any) {
          console.error("[BuyButton] Payluk SDK error:", sdkErr);
          toast({ title: "Payment Error", description: sdkErr?.message || "An error occurred during payment.", variant: "destructive" });
        }
      } else if (data.paymentLink) {
        window.location.href = data.paymentLink;
      }
    } catch {
      toast({ title: "Error", description: "Something went wrong. Please try again.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {pendingTransactionId && (
        <div className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 space-y-2">
          <p className="text-sm font-semibold text-foreground">Previous checkout saved</p>
          <p className="text-xs text-muted-foreground">
            Left YRDLY to pay by bank transfer? Check your payment before transferring again.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={checkPendingPayment} disabled={checkingPending || loading}
              className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">
              {checkingPending ? 'Checking...' : 'Check payment status'}
            </button>
            <button type="button" onClick={() => setOpen(true)} disabled={loading}
              className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground disabled:opacity-50">
              Resume checkout
            </button>
          </div>
        </div>
      )}
      {/* Trigger */}
      <button
        onClick={() => setOpen(true)}
        className="w-full h-14 bg-primary rounded-full flex items-center justify-center font-editorial font-bold text-[0.875rem] text-primary-foreground shadow-lg active:scale-95 transition-transform hover:opacity-90"
      >
        Buy Now
      </button>

      {/* Overlay */}
      {open && (
        <div
          className="fixed inset-0 z-[110] bg-black/70 backdrop-blur-sm flex items-end md:items-center justify-center font-yrdly-body"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          {/* Sheet */}
          <div className="relative w-full max-w-md bg-[var(--yrdly-dark)] border border-[var(--yrdly-glass-border)] rounded-t-2xl md:rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[92dvh]">
            
            {/* Header */}
            <header className="bg-[var(--yrdly-dark)]/90 backdrop-blur-xl flex items-center px-6 h-16 w-full flex-shrink-0 z-10 border-b border-[var(--yrdly-glass-border)]">
              <div className="flex items-center gap-4 w-full">
                <button 
                  onClick={() => setOpen(false)}
                  className="hover:bg-accent/50 transition-all active:scale-95 flex items-center justify-center w-9 h-9 rounded-full text-foreground/80 hover:text-foreground border border-border/40"
                >
                  <X className="w-5 h-5" />
                </button>
                <h1 className="font-yrdly-display font-bold text-xl tracking-tight text-foreground">
                  Order Summary
                </h1>
              </div>
            </header>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto px-6 pt-6 pb-8 custom-scrollbar font-yrdly-body space-y-5">

              {/* Item card */}
              <div className="p-4 rounded-2xl bg-gradient-to-b from-card/80 to-card/40 border border-border/60 backdrop-blur-md flex gap-4 items-center shadow-sm">
                {itemImageUrl && (
                  <div className="w-14 h-14 shrink-0 rounded-xl overflow-hidden border border-border/80 bg-muted/30 shadow-inner">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={itemImageUrl}
                      alt={itemTitle}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
                <div className="flex flex-col gap-1 flex-1 min-w-0">
                  <h2 className="font-bold text-sm text-foreground leading-snug truncate">
                    {itemTitle}
                  </h2>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="bg-primary/10 border border-primary/20 text-[0.625rem] font-bold px-2 py-0.5 rounded-md text-primary uppercase tracking-wider">
                      {condition}
                    </span>
                    <span className="text-xs text-muted-foreground truncate">
                      Sold by <span className="font-semibold text-foreground/90">{sellerName}</span>
                    </span>
                  </div>
                </div>
              </div>

              {/* Price breakdown */}
              <div className="p-5 rounded-2xl bg-gradient-to-b from-card/80 to-card/40 border border-border/60 backdrop-blur-md flex flex-col gap-3.5 shadow-sm">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground font-medium">Item Price</span>
                  <span className="font-semibold text-foreground">₦{price.toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground font-medium">Platform Fee</span>
                    <div className="group relative cursor-help">
                      <Info className="w-3.5 h-3.5 text-muted-foreground/70 hover:text-foreground transition-colors" />
                    </div>
                  </div>
                  <span className="font-semibold text-muted-foreground">₦{commission.toLocaleString()} (seller pays)</span>
                </div>

                <div className="h-px w-full bg-border/50 my-0.5" />

                <div className="flex justify-between items-center">
                  <span className="font-bold text-base text-foreground">You Pay</span>
                  <span className="font-bold text-xl text-primary tracking-tight">
                    ₦{totalPay.toLocaleString()}
                  </span>
                </div>
                <p className="text-[0.7rem] text-muted-foreground/80 leading-normal">
                  Funds are held securely in escrow until you confirm item receipt.
                  Bank transfers may take up to 30 minutes or longer to reconcile.
                </p>
              </div>

              {/* Escrow explainer */}
              <div className="p-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 backdrop-blur-md flex gap-3.5 items-start">
                <div className="shrink-0 p-2 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-400">
                  <Lock className="w-4 h-4" />
                </div>
                <div className="flex flex-col gap-0.5">
                  <h3 className="font-bold text-xs text-emerald-300 uppercase tracking-wider">
                    Your payment is held in escrow
                  </h3>
                  <p className="text-xs text-foreground/80 leading-relaxed">
                    Release funds only after you receive and inspect the item.
                  </p>
                </div>
              </div>

              {/* CTA */}
              <div className="pt-2 flex flex-col items-center gap-3">
                <button
                  onClick={() => handleBuy('checkout')}
                  disabled={loading}
                  className="w-full h-13 py-3.5 bg-primary text-primary-foreground rounded-2xl font-bold text-sm shadow-[0_4px_24px_rgba(0,210,106,0.25)] hover:shadow-[0_6px_28px_rgba(0,210,106,0.35)] active:scale-[0.98] transition-all flex items-center justify-center disabled:opacity-60"
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" strokeOpacity=".3" />
                        <path d="M12 2a10 10 0 0 1 10 10" />
                      </svg>
                      Processing Payment...
                    </span>
                  ) : (
                    `Pay ₦${totalPay.toLocaleString()} Securely`
                  )}
                </button>
                {walletRecoveryAvailable && (
                <>
                <button type="button" onClick={() => handleBuy('wallet')} disabled={loading}
                  className="w-full rounded-2xl border border-border px-4 py-3 text-sm font-semibold text-foreground disabled:opacity-50">
                  {loading ? 'Processing...' : 'Pay from my Payluk wallet'}
                </button>
                <p className="text-xs text-muted-foreground text-center">
                  Already transferred money but checkout expired? Use your credited Payluk wallet without transferring again.
                </p>
                </>
                )}
                <div className="flex items-center gap-1.5 text-muted-foreground/70">
                  <Lock className="w-3.5 h-3.5" />
                  <span className="text-[0.6875rem] font-medium">
                    256-bit SSL Bank-Grade Security
                  </span>
                </div>
              </div>
            </div>

            {/* Handle bar for mobile sheet feel */}
            <div className="absolute top-2 left-1/2 -translate-x-1/2 w-10 h-1 bg-[var(--yrdly-label)]/20 rounded-full md:hidden"></div>
          </div>
        </div>
      )}
    </>
  );
}

