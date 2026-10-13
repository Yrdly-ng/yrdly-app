"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, X } from "lucide-react";
import { useAuth } from "@/hooks/use-supabase-auth";
import { supabase } from "@/lib/supabase";
import { Community, CommunityService } from "@/lib/community-service";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

type PendingCommunity = Community & { creator?: { name?: string; phone_verified?: boolean } | null };

export default function CommunityApprovalPage() {
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const [items, setItems] = useState<PendingCommunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && (!profile || !((profile as any).is_admin || (profile as any).role === "admin" || (profile as any).role === "moderator"))) {
      router.replace("/home");
    }
  }, [authLoading, profile, router]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("communities")
      .select("*, creator:public_profiles!communities_created_by_fkey(name, phone_verified)")
      .eq("approval_status", "pending").order("created_at", { ascending: true });
    if (error) toast({ title: "Could not load submissions", description: error.message, variant: "destructive" });
    setItems((data ?? []) as PendingCommunity[]);
    setLoading(false);
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const review = async (item: PendingCommunity, decision: "approved" | "rejected") => {
    if (!user) return;
    setBusyId(item.id);
    try {
      await CommunityService.reviewCommunity(item.id, user.id, decision);
      setItems((current) => current.filter((row) => row.id !== item.id));
      toast({ title: decision === "approved" ? "Community approved" : "Community rejected" });
    } catch (error: any) {
      toast({ title: "Review failed", description: error.message || "Please try again.", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <main className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="icon" onClick={() => router.back()} aria-label="Back"><ArrowLeft className="h-4 w-4" /></Button>
        <div><h1 className="text-2xl font-bold">Community submissions</h1><p className="text-sm text-muted-foreground">Review names, descriptions, images, and membership settings.</p></div>
      </div>
      {loading ? <p className="py-12 text-center text-muted-foreground">Loading submissions…</p> : items.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-muted-foreground">No communities waiting for review.</div>
      ) : items.map((item) => (
        <article key={item.id} className="overflow-hidden rounded-xl border border-border bg-card">
          {item.banner_url && <img src={item.banner_url} alt={`${item.name} banner`} className="h-40 w-full object-cover" />}
          <div className="space-y-4 p-5">
            <div className="flex items-center gap-3">
              {item.avatar_url ? <img src={item.avatar_url} alt="" className="h-14 w-14 rounded-full object-cover" /> : <div className="h-14 w-14 rounded-full bg-muted" />}
              <div><h2 className="text-lg font-semibold">{item.name}</h2><p className="text-xs text-muted-foreground">Submitted by {item.creator?.name || "Unknown user"} · {item.creator?.phone_verified ? "Phone verified" : "Unverified"} · {item.privacy} · {new Date(item.created_at).toLocaleString()}</p></div>
            </div>
            <p className="whitespace-pre-wrap text-sm">{item.description || "No description"}</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={busyId === item.id} onClick={() => review(item, "rejected")}><X className="mr-2 h-4 w-4" />Reject</Button>
              <Button disabled={busyId === item.id} onClick={() => review(item, "approved")}><Check className="mr-2 h-4 w-4" />Approve</Button>
            </div>
          </div>
        </article>
      ))}
    </main>
  );
}
