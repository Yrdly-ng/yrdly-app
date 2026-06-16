"use client";

import React, { useState } from "react";
import { X, Lock, Info, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useRouter } from "next/navigation";
import { MARKETPLACE_CONSTANTS } from "@/lib/constants";
import { supabase } from "@/lib/supabase";


/* ── Design tokens ─────────────────────────────────── */
const BG     = "var(--c-bg)";
const CARD   = "var(--c-card)";
const CARDH  = "var(--c-card2)";
const GREEN  = "hsl(var(--primary))";
const GREEN_L = "#82DB7E";
const MUTED  = "var(--c-text-muted)";
const DIM    = "var(--c-text-muted)";

interface BuyButtonProps {
  itemId: string;
  itemTitle: string;
  itemImageUrl?: string;
  price: number;
  condition?: string;
  sellerId: string;
  sellerName: string;
}

export function BuyButton({
  itemId,
  itemTitle,
  itemImageUrl,
  price,
  condition = "Used",
  sellerId,
  sellerName,
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
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.paymentLink) {
        toast({
          title: "Error",
          description: data.error ?? "Failed to initialize payment.",
          variant: "destructive",
        });
        return;
      }

      setOpen(false);
      // Navigate to redirect loading page then to Paystack
      router.push(
        `/payment/redirect?link=${encodeURIComponent(data.paymentLink)}&txn=${data.transactionId}`
      );
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
        Buy Now — ₦{price.toLocaleString()}
      </button>

      {/* Overlay */}
      {open && (
        <div
          className="fixed inset-0 z-[110] bg-black/60 flex items-end md:items-center justify-center"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          {/* Sheet */}
          <div className="relative w-full max-w-md bg-surface-dim rounded-t-lg md:rounded-lg overflow-hidden shadow-2xl flex flex-col max-h-[92dvh]">
            
            {/* Header */}
            <header className="bg-[var(--c-bg)]/80 backdrop-blur-xl flex items-center px-6 h-16 w-full flex-shrink-0 z-10 border-b border-surface-container-low">
              <div className="flex items-center gap-4 w-full">
                <button 
                  onClick={() => setOpen(false)}
                  className="hover:opacity-80 transition-opacity active:scale-95 transition-transform flex items-center justify-center p-2 rounded-full"
                >
                  <X className="w-5 h-5 text-primary" />
                </button>
                <h1 className="font-display text-2xl tracking-tight text-on-surface">
                  Order Summary
                </h1>
              </div>
            </header>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto px-6 pt-6 pb-10 custom-scrollbar">

              {/* Item card */}
              <section className="bg-surface-container-high rounded-[11px] p-4 flex gap-4 mb-6 transition-all hover:bg-surface-container">
                {itemImageUrl && (
                  <div className="w-14 h-14 shrink-0 rounded-[8px] overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={itemImageUrl}
                      alt={itemTitle}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
                <div className="flex flex-col gap-1.5 flex-1">
                  <div className="flex justify-between items-start">
                    <h2 className="font-editorial font-bold text-[0.875rem] text-on-surface leading-tight line-clamp-2">
                      {itemTitle}
                    </h2>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="bg-surface-container text-[0.625rem] font-editorial px-2 py-0.5 rounded-full text-on-surface-variant uppercase tracking-wider">
                      {condition}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className="font-editorial text-[0.75rem] text-on-surface-variant">
                        Sold by {sellerName}
                      </span>
                    </div>
                  </div>
                </div>
              </section>

              {/* Price breakdown */}
              <section className="bg-surface-container rounded-[11px] p-4 mb-6 flex flex-col gap-3">
                <div className="flex justify-between items-center">
                  <span className="font-editorial text-[0.8125rem] text-on-surface-variant">
                    Item Price
                  </span>
                  <span className="font-editorial text-[0.875rem] text-on-surface">
                    ₦{price.toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-1.5">
                    <span className="font-editorial text-[0.8125rem] text-on-surface-variant">
                      Platform Fee
                    </span>
                    <Info className="w-[14px] h-[14px] text-on-surface-variant/60" />
                  </div>
                  <span className="font-editorial text-[0.875rem] text-on-surface-variant">
                    ₦{commission.toLocaleString()}
                  </span>
                </div>
                <div className="h-[1px] w-full bg-on-surface/5 my-1" />
                <div className="flex justify-between items-center py-1">
                  <span className="font-editorial font-bold text-[0.9375rem] text-on-surface">
                    You Pay
                  </span>
                  <span className="font-editorial font-bold text-[1.125rem] text-on-surface">
                    ₦{totalPay.toLocaleString()}
                  </span>
                </div>
                <p className="font-editorial text-[0.6875rem] text-on-surface-variant mt-1 leading-normal">
                  Funds are held securely until you confirm receipt
                </p>
              </section>

              {/* Escrow explainer */}
              <section className="bg-tertiary-container/10 border border-tertiary/20 rounded-[11px] p-4 mb-8 flex gap-3">
                <div className="shrink-0 mt-0.5">
                  <Lock className="w-[20px] h-[20px] text-tertiary" />
                </div>
                <div className="flex flex-col gap-0.5">
                  <h3 className="font-editorial font-bold text-[0.8125rem] text-on-surface">
                    Your payment is held in escrow
                  </h3>
                  <p className="font-editorial text-[0.6875rem] text-on-surface-variant leading-relaxed">
                    Release funds only after you confirm the item is in good condition.
                  </p>
                </div>
              </section>

              {/* Payment Method */}
              <div className="mb-10">
                <label className="block font-editorial font-medium text-[0.75rem] text-on-surface-variant mb-3 px-1">
                  Pay with
                </label>
                <div className="bg-surface-container-high border border-primary rounded-[11px] p-4 flex items-center justify-between group cursor-pointer active:scale-[0.98] transition-all">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 flex items-center justify-center bg-background rounded-md p-1.5">
                      <svg className="w-full h-full" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" fill="#00315f"></path>
                        <path d="M12 6c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4z" fill="#00315f"></path>
                      </svg>
                    </div>
                    <span className="font-editorial text-[0.875rem] text-on-surface">Debit/Credit Card</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-primary" />
                </div>
              </div>

              {/* CTA */}
              <div className="flex flex-col items-center gap-4">
                <button
                  onClick={handleBuy}
                  disabled={loading}
                  className="w-full h-14 bg-primary rounded-full flex items-center justify-center font-editorial font-bold text-[0.875rem] text-primary-foreground shadow-lg active:scale-95 transition-transform hover:opacity-90 disabled:opacity-75"
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" strokeOpacity=".3" />
                        <path d="M12 2a10 10 0 0 1 10 10" />
                      </svg>
                      Processing...
                    </span>
                  ) : (
                    `Pay ₦${totalPay.toLocaleString()} Securely`
                  )}
                </button>
                <div className="flex items-center gap-1.5 opacity-60">
                  <Lock className="w-[14px] h-[14px] text-on-surface-variant" />
                  <span className="font-editorial text-[0.6875rem] text-on-surface-variant">
                    256-bit SSL secured
                  </span>
                </div>
              </div>
            </div>

            {/* Handle bar for mobile sheet feel */}
            <div className="absolute top-2 left-1/2 -translate-x-1/2 w-10 h-1 bg-on-surface/10 rounded-full md:hidden"></div>
          </div>
        </div>
      )}
    </>
  );
}
