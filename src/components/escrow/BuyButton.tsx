"use client";

import React, { useState } from "react";
import { X, Lock, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useRouter } from "next/navigation";
import { MARKETPLACE_CONSTANTS } from "@/lib/constants";
import { supabase } from "@/lib/supabase";


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

  const commission = Math.round(price * MARKETPLACE_CONSTANTS.COMMISSION_RATE);
  const totalPay   = price + commission;

  const handleBuy = async () => {
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

      if (!res.ok || (!data.paylukPaymentToken && !data.paymentLink)) {
        console.error("[BuyButton] Payment initialization failed:", res.status, data);
        toast({
          title: "Payment Error",
          description: data.error || data.message || "Failed to initialize payment.",
          variant: "destructive",
        });
        return;
      }

      setOpen(false);

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
                paymentSucceeded = true;
                try {
                  await fetch('/api/payment/verify', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': `Bearer ${session.access_token}`,
                    },
                    body: JSON.stringify({ txRef: data.transactionId }),
                  });
                } catch (verifyErr) {
                  console.error('[BuyButton] Payment verification error:', verifyErr);
                }
                toast({ title: "Payment Successful", description: "Your transaction has been processed." });
                router.push(`/transactions/${data.transactionId}`);
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
                    toast({ title: "Payment Successful", description: "Your transaction has been processed." });
                    router.push(`/transactions/${data.transactionId}`);
                    return;
                  }
                } catch (err) {
                  console.warn('[BuyButton] onClose verification check error:', err);
                }

                toast({ title: "Payment Cancelled", description: "You closed the payment window." });
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
                  <span className="font-semibold text-muted-foreground">₦{commission.toLocaleString()}</span>
                </div>

                <div className="h-px w-full bg-border/50 my-0.5" />

                <div className="flex justify-between items-center">
                  <span className="font-bold text-base text-foreground">You Pay</span>
                  <span className="font-bold text-xl text-primary tracking-tight">
                    ₦{totalPay.toLocaleString()}
                  </span>
                </div>
                <p className="text-[0.7rem] text-muted-foreground/80 leading-normal">
                  Funds are held securely in escrow until you confirm item receipt
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
                  onClick={handleBuy}
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

