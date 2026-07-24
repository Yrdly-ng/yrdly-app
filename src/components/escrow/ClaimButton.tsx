"use client";

import React, { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

interface ClaimButtonProps {
  itemId: string;
  itemTitle: string;
  sellerId: string;
}

export function ClaimButton({
  itemId,
  itemTitle,
  sellerId,
}: ClaimButtonProps) {
  const { user }  = useAuth();
  const { toast } = useToast();
  const router    = useRouter();
  const [loading, setLoading] = useState(false);

  const handleClaim = async () => {
    if (!user) {
      toast({ title: "Sign in required", description: "Please log in to claim items.", variant: "destructive" });
      return;
    }
    if (user.id === sellerId) {
      toast({ title: "Not allowed", description: "You cannot claim your own item.", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast({ title: "Session expired", description: "Please log in again.", variant: "destructive" });
        return;
      }

      const res = await fetch("/api/marketplace/claim", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          itemId,
          buyerId: user.id,
          sellerId,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast({
          title: "Error",
          description: data.error ?? "Failed to claim item.",
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Success!",
        description: "You have successfully claimed this item.",
      });
      
      // Navigate straight to the transaction page to coordinate pickup
      router.push(`/transactions/${data.transactionId}`);
    } catch {
      toast({ title: "Error", description: "Something went wrong. Please try again.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleClaim}
      disabled={loading}
      className="w-full h-14 bg-primary rounded-full flex items-center justify-center font-editorial font-bold text-[0.875rem] text-primary-foreground shadow-lg active:scale-95 transition-transform hover:opacity-90 disabled:opacity-75"
    >
      {loading ? (
        <span className="flex items-center gap-2">
          <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" strokeOpacity=".3" />
            <path d="M12 2a10 10 0 0 1 10 10" />
          </svg>
          Claiming...
        </span>
      ) : (
        `Claim Free Item`
      )}
    </button>
  );
}
