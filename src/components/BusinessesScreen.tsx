"use client";

import { useState, useEffect, useMemo } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Heart, MessageCircle, Share2, MapPin, Briefcase, Plus, MoreVertical, Trash2, Edit } from "lucide-react";
import { useAuth } from "@/hooks/use-supabase-auth";
import { supabase } from "@/lib/supabase";
import Image from "next/image";
import type { Business } from "@/types";
import { shortenAddress } from "@/lib/utils";
import { CreateBusinessDialog } from "@/components/CreateBusinessDialog";
import { useRouter } from "next/navigation";
import { usePosts } from "@/hooks/use-posts";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "@/contexts/LocationContext";
import { LocationChip } from "@/components/LocationChip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const GREEN = "#388E3C";
const CARD = "var(--c-card)";
const FONT = "Inter, sans-serif";
const PACIFICO = "Pacifico, cursive";
const JAKARTA = "Inter, sans-serif";

const CATEGORY_ICONS: Record<string, string> = {
  "Restaurant & Food": "🍲",
  "Restaurant": "🍲",
  "Food": "🍲",
  "Health & Wellness": "💆",
  "Health & Fitness": "💆",
  "Fitness": "💆",
  "Retail & Shopping": "🛍️",
  "Retail": "🛍️",
  "Shopping": "🛍️",
  "Professional Services": "🛠️",
  "Services": "🛠️",
  "Arts & Crafts": "🎨",
  "Creative": "🎨",
  "Entertainment & Recreation": "✨",
  "Nightlife": "✨",
  "Entertainment": "✨",
  "Beauty & Personal Care": "💄",
  "Beauty": "💄",
  "Technology & Electronics": "📱",
  "Technology": "📱",
  "Education & Training": "📚",
  "Education": "📚",
};

function getIcon(cat: string) {
  return CATEGORY_ICONS[cat] || "🏢";
}

interface BusinessesScreenProps {
  className?: string;
}

function BusinessCard({ business }: { business: Business }) {
  const { user } = useAuth();
  const router = useRouter();
  const { deleteBusiness } = usePosts();
  const { toast } = useToast();
  const [isLiked, setIsLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const isOwner = user?.id === business.owner_id;

  const handleDelete = async () => {
    try {
      await deleteBusiness(business.id);
      toast({ title: "Business deleted successfully" });
    } catch {
      toast({ title: "Error", description: "Failed to delete business.", variant: "destructive" });
    }
  };

  const handleLike = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsLiked(!isLiked);
    setLikeCount((c) => (isLiked ? c - 1 : c + 1));
  };

  const handleShare = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (navigator.share) {
      navigator.share({ title: business.name, text: business.description || "", url: window.location.href });
    } else {
      navigator.clipboard.writeText(window.location.href);
    }
  };

  const handleMessage = (e: React.MouseEvent) => {
    e.stopPropagation();
    toast({ title: "Message Business", description: `Messaging ${business.name}` });
  };

  const coverImg = business.image_urls?.[0];

  return (
    <div
      className="overflow-hidden group cursor-pointer"
      style={{ background: 'var(--c-card)', borderRadius: 16, border: "1px solid rgba(64,73,61,0.1)" }}
    >
      {/* Image with hover scale */}
      <div className="relative overflow-hidden" style={{ aspectRatio: '4/3' }}>
        {coverImg ? (
          <Image
            src={coverImg}
            alt={business.name} fill sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            className="object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center" style={{ background: "var(--c-card2)" }}>
            <Briefcase className="w-10 h-10" style={{ color: GREEN, opacity: 0.4 }} />
          </div>
        )}
        {/* Like button overlay */}
        <div className="absolute top-3 right-3">
          <button
            onClick={handleLike}
            className="w-9 h-9 rounded-full flex items-center justify-center transition-colors"
            style={{ background: "rgba(0,0,0,0.4)", backdropFilter: "blur(8px)" }}
          >
            <Heart className="w-5 h-5" style={{ color: isLiked ? "#E53935" : "#fff", fill: isLiked ? "#E53935" : "none" }} />
          </button>
        </div>
        {/* Owner badge */}
        {isOwner && (
          <div className="absolute top-3 left-3 rounded-full px-2 py-0.5 text-[0.625rem] font-bold uppercase text-foreground"
            style={{ background: GREEN, fontFamily: FONT }}>
            Your Business
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-5">
        <div className="flex justify-between items-start mb-2">
          <div className="flex-1 min-w-0">
            <p className="text-[0.625rem] font-bold uppercase tracking-wider mb-1" style={{ color: GREEN, fontFamily: FONT }}>
              {business.category}
            </p>
            <h4 className="text-[1.0625rem] font-bold text-foreground truncate" style={{ fontFamily: JAKARTA }}>
              {business.name}
            </h4>
          </div>
          <div className="flex gap-2 ml-2">
            {user?.id !== business.owner_id && (
              <button onClick={handleMessage}>
                <MessageCircle className="w-5 h-5 transition-colors" style={{ color: "var(--c-text-muted)" }}
                  onMouseEnter={(e) => ((e.currentTarget as SVGElement).style.color = GREEN)}
                  onMouseLeave={(e) => ((e.currentTarget as SVGElement).style.color = "var(--c-text-muted)")} />
              </button>
            )}
            <button onClick={handleShare}>
              <Share2 className="w-5 h-5 transition-colors" style={{ color: "var(--c-text-muted)" }}
                onMouseEnter={(e) => ((e.currentTarget as SVGElement).style.color = GREEN)}
                onMouseLeave={(e) => ((e.currentTarget as SVGElement).style.color = "var(--c-text-muted)")} />
            </button>
            {isOwner && (
              <AlertDialog>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button><MoreVertical className="w-5 h-5" style={{ color: "var(--c-text-muted)" }} /></button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" style={{ background: 'var(--c-card)', border: "1px solid rgba(64,73,61,0.2)" }}>
                    <CreateBusinessDialog postToEdit={business}>
                      <DropdownMenuItem onSelect={(e) => e.preventDefault()} style={{ fontFamily: FONT }}>
                        <Edit className="mr-2 w-4 h-4" /> Edit
                      </DropdownMenuItem>
                    </CreateBusinessDialog>
                    <AlertDialogTrigger asChild>
                      <DropdownMenuItem style={{ fontFamily: FONT, color: "#E53935" }}>
                        <Trash2 className="mr-2 w-4 h-4" /> Delete
                      </DropdownMenuItem>
                    </AlertDialogTrigger>
                  </DropdownMenuContent>
                </DropdownMenu>
                <AlertDialogContent style={{ background: CARD }}>
                  <AlertDialogHeader>
                    <AlertDialogTitle className="text-foreground">Delete Business?</AlertDialogTitle>
                    <AlertDialogDescription style={{ color: "var(--c-text-muted)" }}>
                      This will permanently delete this business listing.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDelete} style={{ background: "#E53935" }}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>

        {business.location?.address && (
          <div className="flex items-center gap-1.5 mb-5 text-[0.8125rem]" style={{ color: "var(--c-text-muted)", fontFamily: FONT }}>
            <MapPin className="w-4 h-4 flex-shrink-0" />
            <span className="truncate">{shortenAddress(business.location.address, 40)}</span>
          </div>
        )}

        <button
          className="w-full py-3 rounded-full text-sm font-bold text-foreground transition-all active:scale-95"
          style={{ background: GREEN, fontFamily: FONT }}
          onClick={() => router.push(`/businesses/${business.id}`)}
        >
          Visit Business
        </button>
      </div>
    </div>
  );
}

export function BusinessesScreen({ className }: BusinessesScreenProps) {
  const router = useRouter();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const { filterState, filterLga } = useLocation();

  useEffect(() => {
    const fetchBusinesses = async () => {
      try {
        let query = supabase
          .from("businesses")
          .select("*")
          .order("created_at", { ascending: false });
          
        if (filterState) {
          query = query.eq('state', filterState);
        }
        if (filterLga) {
          query = query.eq('lga', filterLga);
        }
        
        const { data, error } = await query;
        if (error) { console.error(error); return; }
        setBusinesses((data as Business[]) || []);
        setLoading(false);
      } catch (e) {
        console.error(e);
        setLoading(false);
      }
    };
    fetchBusinesses();

    let filterString: string | undefined = undefined;
    if (filterLga) {
      filterString = `lga=eq.${filterLga}`;
    } else if (filterState) {
      filterString = `state=eq.${filterState}`;
    }

    const ch = supabase
      .channel("businesses-all")
      .on("postgres_changes", { event: "*", schema: "public", table: "businesses", filter: filterString }, (payload) => {
        if (payload.eventType === "INSERT") {
          const newBusiness = payload.new as Business;
          if (filterState && newBusiness.state && newBusiness.state !== filterState) return;
          if (filterLga && newBusiness.lga && newBusiness.lga !== filterLga) return;
          setBusinesses((p) => [newBusiness, ...p]);
        }
        else if (payload.eventType === "UPDATE") {
          const u = payload.new as Business;
          setBusinesses((p) => p.map((b) => (b.id === u.id ? u : b)));
        } else if (payload.eventType === "DELETE") {
          setBusinesses((p) => p.filter((b) => b.id !== payload.old.id));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [filterState, filterLga]);

  // Derive categories from real data
  const categoryStats = useMemo(() => {
    const counts: Record<string, number> = {};
    businesses.forEach((b) => { if (b.category) counts[b.category] = (counts[b.category] || 0) + 1; });
    return Object.entries(counts).map(([name, count]) => ({ name, count, icon: getIcon(name) }));
  }, [businesses]);

  const filteredBusinesses = useMemo(() => {
    return businesses.filter((b) => {
      const queryOk = !searchQuery ||
        b.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        b.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        b.category?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        b.location?.address?.toLowerCase().includes(searchQuery.toLowerCase());
      const catOk = !selectedCategory || b.category === selectedCategory;
      return queryOk && catOk;
    });
  }, [businesses, searchQuery, selectedCategory]);

  const featured = filteredBusinesses[0];
  const rest = filteredBusinesses.slice(1);

  return (
    <div className={`min-h-[100dvh] pb-28 ${className}`} style={{ background: "var(--c-bg)" }}>
      <div className="max-w-7xl mx-auto px-4 pt-6 space-y-10">

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <h1 className="text-[1.25rem]" style={{ fontFamily: PACIFICO, color: GREEN }}>
            Local Businesses
          </h1>
          <div className="relative w-full md:w-80">
            <input
              type="text"
              placeholder="Search neighborhood gems..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-full py-3 px-6 pr-12 text-sm text-foreground outline-none"
              style={{ background: "var(--c-card2)", fontFamily: FONT, caretColor: GREEN }}
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xl" style={{ color: GREEN }}>⚙</span>
          </div>
        </div>

        {/* Location Filter */}
        <div className="flex justify-start">
          <LocationChip />
        </div>

        {/* Featured Hero Card */}
        {loading ? (
          <Skeleton className="h-64 w-full rounded-[16px]" style={{ background: CARD }} />
        ) : featured ? (
          <section
            className="relative overflow-hidden cursor-pointer shadow-2xl"
            style={{ borderRadius: 16, height: 280 }}
            onClick={() => router.push(`/businesses/${featured.id}`)}
          >
            {/* Background image */}
            <div className="absolute inset-0">
              {featured.image_urls?.[0] ? (
                <Image src={featured.image_urls[0]} alt={featured.name} fill sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw" className="object-cover transition-transform duration-700 hover:scale-105" />
              ) : (
                <div className="w-full h-full flex items-center justify-center" style={{ background: "var(--c-card2)" }}>
                  <Briefcase className="w-16 h-16" style={{ color: GREEN, opacity: 0.3 }} />
                </div>
              )}
              {/* Gradient overlay */}
              <div className="absolute inset-0" style={{ background: "linear-gradient(to top, var(--c-bg) 0%, transparent 50%)" }} />
            </div>

            {/* Featured badge */}
            <div className="absolute top-5 left-5">
              <span className="rounded-full px-4 py-1.5 text-[0.625rem] font-bold uppercase tracking-widest border"
                style={{ background: "var(--c-bg)", color: GREEN, borderColor: "rgba(56,142,60,0.2)", fontFamily: FONT }}>
                Featured
              </span>
            </div>

            {/* Bottom content (glassmorphism) */}
            <div className="absolute bottom-0 left-0 right-0 p-6"
              style={{ background: "rgba(16,20,24,0.5)", backdropFilter: "blur(12px)" }}>
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
                <div>
                  {featured.rating && (
                    <div className="flex items-center gap-1.5 mb-1">
                      <span style={{ color: GREEN }}>★</span>
                      <span className="font-bold text-sm" style={{ color: GREEN }}>{featured.rating}</span>
                      <span className="text-sm" style={{ color: "var(--c-text-muted)" }}>({featured.review_count || 0} reviews)</span>
                    </div>
                  )}
                  <h2 className="text-[1.375rem] font-extrabold text-foreground leading-tight" style={{ fontFamily: JAKARTA }}>
                    {featured.name}
                  </h2>
                  <p className="text-sm max-w-md mt-1" style={{ color: "var(--c-text-muted)" }}>{featured.description}</p>
                </div>
                <button
                  className="rounded-full px-7 py-3 text-sm font-bold text-foreground transition-all active:scale-95 shadow-lg whitespace-nowrap"
                  style={{ background: GREEN, fontFamily: FONT }}
                  onClick={(e) => { e.stopPropagation(); router.push(`/businesses/${featured.id}`); }}
                >
                  Visit Business
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {/* Category Chips */}
        {categoryStats.length > 0 && (
          <section className="space-y-5">
            <h3 className="text-[0.6875rem] font-bold uppercase tracking-[0.2em]" style={{ color: "var(--c-text-muted)", fontFamily: FONT }}>
              Explore Categories
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {categoryStats.map(({ name, icon }) => (
                <button
                  key={name}
                  onClick={() => setSelectedCategory(selectedCategory === name ? null : name)}
                  className="flex items-center gap-3 p-4 text-left transition-all"
                  style={{
                    background: selectedCategory === name ? "rgba(56,142,60,0.15)" : CARD,
                    borderRadius: 16,
                    border: selectedCategory === name ? `1px solid ${GREEN}` : "1px solid transparent",
                  }}
                >
                  <span className="text-2xl">{icon}</span>
                  <span className="font-semibold text-sm text-foreground" style={{ fontFamily: FONT }}>{name}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Business Grid */}
        <section className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-[0.6875rem] font-bold uppercase tracking-[0.2em]" style={{ color: "var(--c-text-muted)", fontFamily: FONT }}>
              {selectedCategory ? selectedCategory : "Nearby Professionals"}
            </h3>
            {selectedCategory && (
              <button onClick={() => setSelectedCategory(null)} className="text-sm font-semibold" style={{ color: GREEN, fontFamily: FONT }}>
                View All
              </button>
            )}
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-72 w-full rounded-[16px]" style={{ background: CARD }} />
              ))}
            </div>
          ) : rest.length === 0 && !featured ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ background: CARD }}>
                <Briefcase className="w-8 h-8" style={{ color: GREEN, opacity: 0.4 }} />
              </div>
              <h3 className="text-foreground text-lg mb-1" style={{ fontFamily: PACIFICO }}>No businesses yet</h3>
              <p className="text-sm" style={{ color: "var(--c-text-muted)", fontFamily: FONT }}>
                Be the first to add a local business!
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {(rest.length > 0 ? rest : filteredBusinesses).map((b) => (
                <BusinessCard key={b.id} business={b} />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* FAB */}
      <CreateBusinessDialog>
        <button
          className="fixed right-4 w-14 h-14 rounded-full flex items-center justify-center z-[110] transition-transform active:scale-90"
          style={{
            bottom: "calc(64px + env(safe-area-inset-bottom) + 16px)",
            background: GREEN,
            boxShadow: "0 20px 40px rgba(0,0,0,0.4)",
          }}
        >
          <Plus className="w-7 h-7 text-foreground" />
        </button>
      </CreateBusinessDialog>
    </div>
  );
}
