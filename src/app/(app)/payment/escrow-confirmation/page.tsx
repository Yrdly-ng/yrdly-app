"use client";

import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ArrowLeft, Check, MessageCircle, Receipt, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";

/* ── Design tokens ─────────────────────────────────── */
const BG     = "var(--c-bg)";
const CARD   = "var(--c-card)";
const GREEN  = "hsl(var(--primary))";
const GREEN_L = "#82DB7E";
const MUTED  = "var(--c-text-muted)";
const DIM    = "var(--c-text-muted)";

const STEPS = [
  { label: "Seller prepares your item", sub: "Notification sent to the seller" },
  { label: "Seller marks item as sent" },
  { label: "You confirm receipt" },
  { label: "Funds released to seller" },
];

export default function EscrowConfirmationPage() {
  const params        = useSearchParams();
  const router        = useRouter();
  const transactionId = params.get("txn") ?? "";
  const amount        = params.get("amount") ?? "0";
  const itemTitle     = params.get("item") ?? "Your item";
  const ref           = params.get("ref") ?? `YRD${Date.now().toString().slice(-5)}`;

  const { user } = useAuth();
  const { toast } = useToast();
  const [isMessaging, setIsMessaging] = useState(false);

  const fmt = (n: string) =>
    `₦${Number(n).toLocaleString("en-NG")}`;

  const handleMessageSeller = async () => {
    if (!transactionId || !user) {
      toast({ variant: "destructive", title: "Error", description: "You must be logged in to message the seller." });
      return;
    }
    setIsMessaging(true);
    try {
      const { data: txData, error: txError } = await supabase
        .from('escrow_transactions')
        .select('item_id, seller_id')
        .eq('id', transactionId)
        .single();

      if (txError || !txData) throw new Error('Transaction not found');

      const { data: itemData, error: itemError } = await supabase
        .from('posts')
        .select('id, title, text, image_urls, price')
        .eq('id', txData.item_id)
        .single();

      if (itemError || !itemData) throw new Error('Item not found');

      const { data: existing } = await supabase
        .from("conversations")
        .select("id")
        .contains("participant_ids", [user.id])
        .eq("type", "marketplace")
        .eq("item_id", itemData.id)
        .limit(1);

      let conversationId: string;

      if (!existing || existing.length === 0) {
        const { data: newConv, error: convError } = await supabase
          .from("conversations")
          .insert({
            participant_ids: [user.id, txData.seller_id].sort(),
            type: "marketplace",
            item_id: itemData.id,
            item_title: itemData.title || itemData.text || "Item",
            item_image: itemData.image_urls?.[0] || "",
            item_price: itemData.price || 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .select("id")
          .single();
          
        if (convError) throw convError;
        conversationId = newConv.id;
      } else {
        conversationId = existing[0].id;
      }

      router.push(`/messages/${conversationId}`);
    } catch (error) {
      console.error(error);
      toast({ variant: "destructive", title: "Error", description: "Could not initiate chat." });
    } finally {
      setIsMessaging(false);
    }
  };

  return (
    <div className="bg-background text-on-surface font-body antialiased min-h-dvh flex flex-col">
      {/* Shared Component: TopAppBar */}
      <header className="fixed top-0 w-full z-50 bg-[var(--c-bg)]/80 backdrop-blur-xl flex items-center px-6 h-16 w-full">
        <div className="flex items-center gap-4">
          <button onClick={() => router.push("/marketplace")} className="active:scale-95 transition-transform hover:opacity-80">
            <ArrowLeft className="w-6 h-6 text-primary" />
          </button>
          <h1 className="font-jersey25 text-2xl tracking-tight text-primary">Checkout</h1>
        </div>
      </header>

      <main className="flex-grow pt-24 pb-32 px-6 max-w-lg mx-auto w-full">
        {/* Success Header Section */}
        <section className="flex flex-col items-center text-center mb-10">
          <div className="relative mb-6">
            {/* Pulsing Ring */}
            <div className="absolute inset-0 rounded-full border-2 border-primary animate-[pulse-ring_2s_cubic-bezier(0.4,0,0.6,1)_infinite]"></div>
            {/* Main Check Icon */}
            <div className="w-16 h-16 rounded-full bg-primary/15 border-2 border-primary flex items-center justify-center relative z-10">
              <Check className="w-8 h-8 text-primary" strokeWidth={3} />
            </div>
          </div>
          <h2 className="font-jersey25 text-[1.625rem] text-[var(--c-text)] leading-tight mb-2">Payment Secured!</h2>
          <p className="font-raleway text-[0.875rem] text-on-surface-variant font-medium">{fmt(amount)} is held safely in escrow</p>
        </section>

        {/* Item Recap Card */}
        <article className="bg-surface-container rounded-[11px] p-4 flex items-center gap-4 mb-10 transition-transform hover:scale-[1.01]">
          <div className="flex-grow min-w-0">
            <h3 className="text-[var(--c-text)] font-bold truncate">{itemTitle}</h3>
            <p className="font-raleway text-[0.6875rem] font-mono text-on-surface-variant">Ref: #{ref}</p>
          </div>
          <div className="flex-shrink-0">
            <span className="px-3 py-1 rounded-full text-[0.625rem] font-bold tracking-wider bg-primary/15 text-[#82DB7E] border border-primary flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#82DB7E] animate-pulse"></span>
              IN ESCROW
            </span>
          </div>
        </article>

        {/* What Happens Next Section */}
        <section className="space-y-6">
          <h4 className="text-on-surface-variant text-[0.75rem] font-bold uppercase tracking-widest mb-4">What Happens Next</h4>
          <div className="relative">
            {/* Connecting Line */}
            <div className="absolute left-4 top-4 bottom-4 w-[1px] bg-outline-variant/30"></div>
            <div className="space-y-8 relative">
              {STEPS.map((step, i) => {
                const active = i === 0;
                return (
                  <div key={i} className={`flex items-start gap-5 ${!active ? 'opacity-40' : 'group'}`}>
                    <div className="relative">
                      {active && (
                        <div className="absolute inset-0 rounded-full bg-primary/40 blur-md"></div>
                      )}
                      <div className={`w-8 h-8 rounded-full border ${active ? 'border-2 border-primary bg-surface-container-high text-primary' : 'border-outline-variant bg-surface-container text-on-surface-variant'} flex items-center justify-center font-bold text-sm relative z-10`}>
                        {i + 1}
                      </div>
                    </div>
                    <div className="pt-1">
                      <p className={`${active ? 'text-[var(--c-text)] font-semibold' : 'text-on-surface font-medium'}`}>{step.label}</p>
                      {step.sub && (
                        <p className="text-xs text-on-surface-variant/70 mt-0.5">{step.sub}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </main>

      {/* Bottom Actions */}
      <footer className="fixed bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-background via-background to-transparent pointer-events-none">
        <div className="max-w-lg mx-auto flex flex-col gap-3 pointer-events-auto">
          <button 
            onClick={handleMessageSeller}
            disabled={isMessaging}
            className="w-full h-14 rounded-full bg-primary text-primary-foreground font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform shadow-lg shadow-[#388E3C]/20 disabled:opacity-70 disabled:active:scale-100"
          >
            {isMessaging ? <Loader2 className="w-5 h-5 animate-spin" /> : <MessageCircle className="w-5 h-5" />}
            Message Seller
          </button>
          <button 
            onClick={() => router.push(`/transactions/${transactionId}`)}
            className="w-full h-14 rounded-full border border-primary text-primary font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform bg-surface/50 backdrop-blur-md"
          >
            <Receipt className="w-5 h-5" />
            View Transaction
          </button>
        </div>
      </footer>

      <style>{`
        @keyframes pulse-ring {
          0% { transform: scale(0.8); opacity: 0.5; }
          100% { transform: scale(1.3); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
