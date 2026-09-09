"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Edit, Trash2, CheckCircle2, ShoppingBag, AlertCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useToast } from "@/hooks/use-toast";

const FONT = "var(--font-work-sans)";
const RALEWAY = "var(--font-jersey25)";

export default function MyListingsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<"active" | "sold">("active");
  const [listings, setListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchMyListings = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    try {
      const { data, error } = await supabase
        .from("posts")
        .select("*")
        .eq("user_id", user.id)
        .in("category", ["For Sale", "Giveaway"])
        .order("timestamp", { ascending: false });

      if (error) throw error;
      setListings(data || []);
    } catch (err) {
      console.error("Error fetching my listings:", err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchMyListings();
  }, [fetchMyListings]);

  const handleMarkSold = async (id: string) => {
    try {
      const { error } = await supabase
        .from("posts")
        .update({ status: "sold" })
        .eq("id", id);

      if (error) throw error;

      setListings((prev) =>
        prev.map((item) => (item.id === id ? { ...item, status: "sold" } : item))
      );
      toast({ title: "Listing marked as sold!" });
    } catch (err: any) {
      toast({ title: err.message || "Failed to update listing", variant: "destructive" });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this listing?")) return;
    setDeletingId(id);

    try {
      const { error } = await supabase.from("posts").delete().eq("id", id);
      if (error) throw error;

      setListings((prev) => prev.filter((item) => item.id !== id));
      toast({ title: "Listing deleted" });
    } catch (err: any) {
      toast({ title: err.message || "Failed to delete listing", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  };

  const filteredListings = listings.filter((item) => {
    const isSold = item.status === "sold";
    return activeTab === "active" ? !isSold : isSold;
  });

  return (
    <div className="min-h-screen bg-background text-foreground pb-20">
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b border-border/40 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-card transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-foreground" />
          </button>
          <h1 className="text-xl font-bold text-foreground" style={{ fontFamily: RALEWAY }}>
            My Marketplace Listings
          </h1>
        </div>

        <button
          onClick={() => router.push("/marketplace")}
          className="px-3.5 py-2 rounded-full bg-primary text-primary-foreground font-bold text-xs flex items-center gap-1.5 shadow"
          style={{ fontFamily: FONT }}
        >
          <Plus className="w-4 h-4" /> New Listing
        </button>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Tabs */}
        <div className="flex bg-card p-1 rounded-xl border border-border/40">
          <button
            onClick={() => setActiveTab("active")}
            className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${
              activeTab === "active"
                ? "bg-primary text-primary-foreground shadow-md"
                : "text-muted-foreground hover:text-foreground"
            }`}
            style={{ fontFamily: FONT }}
          >
            Active Listings ({listings.filter((i) => i.status !== "sold").length})
          </button>
          <button
            onClick={() => setActiveTab("sold")}
            className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${
              activeTab === "sold"
                ? "bg-primary text-primary-foreground shadow-md"
                : "text-muted-foreground hover:text-foreground"
            }`}
            style={{ fontFamily: FONT }}
          >
            Sold ({listings.filter((i) => i.status === "sold").length})
          </button>
        </div>

        {/* Content */}
        {loading ? (
          <div className="py-12 flex justify-center">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredListings.length === 0 ? (
          <div className="py-12 text-center bg-card rounded-2xl border border-border/40 text-muted-foreground space-y-2">
            <ShoppingBag className="w-10 h-10 text-muted-foreground mx-auto opacity-50" />
            <p className="font-semibold text-sm" style={{ fontFamily: FONT }}>
              No {activeTab} listings
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {filteredListings.map((item) => (
              <div
                key={item.id}
                className="rounded-2xl bg-card border border-border/40 overflow-hidden flex flex-col justify-between shadow-sm"
              >
                <div>
                  <div className="relative aspect-video bg-muted overflow-hidden">
                    {item.image_url ? (
                      <img src={item.image_url} alt={item.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                        No Image
                      </div>
                    )}
                    <span className="absolute top-2 left-2 px-2.5 py-1 rounded-full bg-black/60 text-white font-bold text-xs backdrop-blur-md">
                      {item.price ? `₦${Number(item.price).toLocaleString()}` : "Free"}
                    </span>
                  </div>

                  <div className="p-4 space-y-1">
                    <h3 className="font-bold text-base text-foreground line-clamp-1" style={{ fontFamily: RALEWAY }}>
                      {item.title || item.content}
                    </h3>
                    <p className="text-xs text-muted-foreground line-clamp-2" style={{ fontFamily: FONT }}>
                      {item.content}
                    </p>
                  </div>
                </div>

                <div className="p-4 pt-0 border-t border-border/40 mt-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => router.push(`/marketplace/edit/${item.id}`)}
                      className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      title="Edit"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(item.id)}
                      disabled={deletingId === item.id}
                      className="p-2 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  {activeTab === "active" && (
                    <button
                      onClick={() => handleMarkSold(item.id)}
                      className="px-3 py-1.5 rounded-lg border border-primary/40 text-primary text-xs font-bold hover:bg-primary/10 transition-colors flex items-center gap-1"
                      style={{ fontFamily: FONT }}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" /> Mark Sold
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
