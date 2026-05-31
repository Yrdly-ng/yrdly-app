"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Send, ShoppingBag, MapPin } from "lucide-react";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import type { Post as PostType } from "@/types";
import { Skeleton } from "@/components/ui/skeleton";
import Image from "next/image";
import { BuyButton } from "@/components/escrow/BuyButton";
import { ClaimButton } from "@/components/escrow/ClaimButton";

/* ─── colour tokens matching the Figma ─────────────────────────── */
const BG = "var(--c-bg)";
const CARD_BG = "var(--c-card)";
const GREEN = "#388E3C";
const FADED = "#BBBBBB";
const FONT_RALEWAY = "\"Pacifico\", cursive";
const FONT_PACIFICO = "Pacifico, cursive";

export default function MarketplaceItemPage() {
  const params = useParams();
  const router = useRouter();
  const { user, profile } = useAuth();
  const { toast } = useToast();

  const [item, setItem] = useState<PostType | null>(null);
  const [relatedItems, setRelatedItems] = useState<PostType[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [message, setMessage] = useState("Hi, Is this available?");
  const [sendingMessage, setSendingMessage] = useState(false);

  const itemId = params.itemId as string;

  /* ── fetch item ── */
  useEffect(() => {
    if (!itemId) return;
    const fetchItem = async () => {
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from("posts")
          .select(`*, user:users!posts_user_id_fkey(id, name, avatar_url, created_at)`)
          .eq("id", itemId)
          .eq("category", "For Sale")
          .single();

        if (error) throw error;
        setItem({ ...data, author_name: data.user?.name, author_image: data.user?.avatar_url });

        /* fetch related items — same state as the viewed item */
        let relatedQuery = supabase
          .from("posts")
          .select(`*, user:users!posts_user_id_fkey(id, name, avatar_url)`)
          .eq("category", "For Sale")
          .eq("is_sold", false)
          .neq("id", itemId)
          .order("timestamp", { ascending: false });
        if (data.state) relatedQuery = relatedQuery.eq("state", data.state);
        const { data: related } = await relatedQuery.limit(4);

        if (related) setRelatedItems(related as PostType[]);
      } catch {
        toast({ variant: "destructive", title: "Error", description: "Failed to load item." });
        router.push("/marketplace");
      } finally {
        setLoading(false);
      }
    };
    fetchItem();
  }, [itemId, router, toast]);

  /* ── send message → creates/opens conversation ── */
  const handleSendMessage = async () => {
    if (!user || !item || !message.trim()) return;
    if (user.id === item.user_id) {
      toast({ variant: "destructive", title: "Error", description: "You cannot message yourself." });
      return;
    }
    setSendingMessage(true);
    try {
      const { data: existing } = await supabase
        .from("conversations")
        .select("id")
        .contains("participant_ids", [user.id])
        .eq("type", "marketplace")
        .eq("item_id", item.id)
        .limit(1);

      let conversationId: string;

      if (!existing || existing.length === 0) {
        const { data: newConv, error } = await supabase
          .from("conversations")
          .insert({
            participant_ids: [user.id, item.user_id].sort(),
            type: "marketplace",
            item_id: item.id,
            item_title: item.title || item.text || "Item",
            item_image: item.image_urls?.[0] || "",
            item_price: item.price || 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .select("id")
          .single();
        if (error) throw error;
        conversationId = newConv.id;
      } else {
        conversationId = existing[0].id;
      }

      /* insert the first message */
      await supabase.from("messages").insert({
        conversation_id: conversationId,
        sender_id: user.id,
        text: message.trim(),
        created_at: new Date().toISOString(),
        is_read: false,
      });

      router.push(`/messages/${conversationId}`);
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Could not send message." });
    } finally {
      setSendingMessage(false);
    }
  };

  const formatPrice = (price?: number | null) =>
    !price || price === 0 ? "FREE" : `₦${price.toLocaleString()}`;

  const images = item?.image_urls?.length ? item.image_urls : item?.image_url ? [item.image_url] : [];
  const isOwn = user?.id === item?.user_id;

  /* ─────────────────────────────────────────── LOADING ── */
  if (loading) {
    return (
      <div className="min-h-[100dvh] p-4" style={{ background: BG }}>
        <div className="flex flex-col lg:flex-row gap-4 mt-4">
          <Skeleton className="flex-1 h-[400px] lg:h-[670px] rounded-xl" style={{ background: CARD_BG }} />
          <Skeleton className="w-full lg:w-[320px] h-[200px] lg:h-[313px] rounded-xl" style={{ background: CARD_BG }} />
        </div>
      </div>
    );
  }

  if (!item) return null;

  /* ─────────────────────────────────────────── RENDER ── */
  return (
    <div className="min-h-[100dvh]" style={{ background: BG }}>

      {/* ── Back button row ── */}
      <div className="sticky top-0 z-50 px-4 py-4 bg-background/95 backdrop-blur-sm border-b" style={{ borderColor: 'var(--c-border)' }}>
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-sm transition-opacity hover:opacity-70"
          style={{ color: FADED, fontFamily: FONT_RALEWAY }}
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Marketplace
        </button>
      </div>

      {/* ── Main two-column layout ── */}
      <div className="px-4 pb-8 flex flex-col lg:flex-row gap-5 items-start">

        {/* ════ LEFT — main item card ════ */}
        <div
          className="flex-1 w-full rounded-xl overflow-hidden"
          style={{ background: CARD_BG }}
        >
          {/* Card header strip */}
          <div
            className="px-6 py-4"
            style={{
              background: "rgba(185,185,185,0.05)",
              borderBottom: "0.2px solid var(--c-border)",
            }}
          >
            <h1
              className="text-2xl font-extrabold text-foreground leading-tight"
              style={{ fontFamily: FONT_RALEWAY }}
            >
              {item.title || item.text || "Item"}
            </h1>
          </div>

          {/* Image + carousel */}
          <div className="px-3 sm:px-6 pt-5">
            <div className="relative w-full rounded-xl overflow-hidden" style={{ aspectRatio: '4/3', maxHeight: '360px' }}>
              {images.length > 0 ? (
                <Image
                  src={images[currentImageIndex]}
                  alt={item.title || "Item image"} fill sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                  className="object-cover"
                />
              ) : (
                <div
                  className="w-full h-full flex items-center justify-center"
                  style={{ background: "var(--c-card2)" }}
                >
                  <ShoppingBag className="w-16 h-16" style={{ color: GREEN, opacity: 0.4 }} />
                </div>
              )}
            </div>

            {/* Dot indicators */}
            {images.length > 1 && (
              <div className="flex items-center justify-center gap-2.5 mt-3 mb-1">
                {images.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setCurrentImageIndex(i)}
                    className="w-[6px] h-[6px] rounded-full transition-colors"
                    style={{ background: i === currentImageIndex ? "var(--c-text)" : FADED }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="mx-6 my-4" style={{ borderTop: "0.2px solid var(--c-border)" }} />

          {/* Details section */}
          <div className="px-6 pb-4">
            <p
              className="font-bold text-[0.8125rem] text-foreground mb-2"
              style={{ fontFamily: FONT_RALEWAY }}
            >
              Details
            </p>
            <p
              className="text-[0.8125rem] text-foreground leading-[18px]"
              style={{ fontFamily: FONT_RALEWAY, fontWeight: 400 }}
            >
              {item.description || item.text || "No description provided."}
            </p>
          </div>

          {/* Divider */}
          <div className="mx-6 my-4" style={{ borderTop: "0.2px solid var(--c-border)" }} />

          {/* Directions / location */}
          <div className="px-6 pb-6">
            <p
              className="font-bold text-[0.8125rem] text-foreground mb-3"
              style={{ fontFamily: FONT_RALEWAY }}
            >
              Directions
            </p>
            {item.lga || item.state ? (
              <div
                className="flex items-center gap-2 px-3 py-3 rounded-xl text-sm"
                style={{ background: "var(--c-card2)", color: FADED, fontFamily: FONT_RALEWAY }}
              >
                <MapPin className="w-4 h-4" style={{ color: GREEN }} />
                <span>{[item.lga, item.state].filter(Boolean).join(", ")}</span>
              </div>
            ) : (
              <div
                className="flex items-center gap-2 px-3 py-3 rounded-xl text-sm"
                style={{ background: "var(--c-card2)", color: FADED, fontFamily: FONT_RALEWAY }}
              >
                <MapPin className="w-4 h-4" style={{ color: GREEN }} />
                <span>Location not specified</span>
              </div>
            )}
          </div>
        </div>

        {/* ════ RIGHT — price + seller + message ════ */}
        <div className="w-full lg:w-[340px] flex-shrink-0 flex flex-col gap-4">

          {/* Price */}
          <p
            className="text-[1.5rem] font-bold leading-[28px]"
            style={{ fontFamily: FONT_RALEWAY, color: GREEN }}
          >
            {formatPrice(item.price)}
          </p>

          {/* Action Buttons — shown only to non-owners */}
          {!isOwn && !item.is_sold && (
            <>
              {Number(item.price) > 0 ? (
                <BuyButton
                  itemId={item.id}
                  itemTitle={item.title || item.text || "Item"}
                  itemImageUrl={images[0]}
                  price={item.price || 0}
                  condition="Used"
                  sellerId={item.user_id}
                  sellerName={item.author_name || "Seller"}
                />
              ) : (
                <ClaimButton
                  itemId={item.id}
                  itemTitle={item.title || item.text || "Item"}
                  sellerId={item.user_id}
                />
              )}
            </>
          )}

          {/* Horizontal divider */}
          <div style={{ borderTop: "0.2px solid var(--c-border)" }} />

          {/* Seller Information */}
          <div>
            <p
              className="font-bold text-[0.8125rem] text-foreground mb-3"
              style={{ fontFamily: FONT_RALEWAY }}
            >
              Seller Information
            </p>
            <button
              className="flex items-center gap-3 hover:opacity-80 transition-opacity w-full text-left"
              onClick={() => router.push(`/profile/${item.user_id}`)}
            >
              <div className="w-9 h-9 rounded-full overflow-hidden flex-shrink-0 flex items-center justify-center text-xs font-bold text-foreground"
                   style={{ background: GREEN }}>
                {item.author_image ? (
                  <Image
                    src={item.author_image}
                    alt={item.author_name || ""}
                    width={36}
                    height={36}
                    className="object-cover w-full h-full"
                  />
                ) : (
                  (item.author_name?.slice(0, 2) || "U").toUpperCase()
                )}
              </div>
              <div>
                <p
                  className="text-[0.8125rem] font-normal text-muted-foreground"
                  style={{ fontFamily: FONT_RALEWAY }}
                >
                  {item.author_name || "Unknown Seller"}
                </p>
                <p
                  className="text-[0.625rem] italic font-extralight text-muted-foreground"
                  style={{ fontFamily: FONT_RALEWAY }}
                >
                  Joined Yrdly in {new Date(item.user?.created_at || item.timestamp).getFullYear()}
                </p>
              </div>
            </button>
          </div>

          {/* Horizontal divider */}
          <div style={{ borderTop: "0.2px solid var(--c-border)" }} />

          {/* Message box (only for non-owners) */}
          {!isOwn && (
            <div className="flex items-start gap-3">
              {/* Current user avatar */}
              <div
                className="w-9 h-9 rounded-full overflow-hidden flex-shrink-0 flex items-center justify-center text-xs font-bold text-foreground mt-1"
                style={{ background: GREEN }}
              >
                {profile?.avatar_url ? (
                  <Image
                    src={profile.avatar_url}
                    alt={profile.name || ""}
                    width={36}
                    height={36}
                    className="object-cover w-full h-full"
                  />
                ) : (
                  (profile?.name?.slice(0, 2) || "U").toUpperCase()
                )}
              </div>

              {/* Input + send */}
              <div className="flex-1 flex flex-col gap-1">
                <div
                  className="relative w-full rounded-xl"
                  style={{
                    background: BG,
                    border: `0.5px solid ${GREEN}`,
                    minHeight: "115px",
                  }}
                >
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Hi, Is this available?"
                    rows={3}
                    className="w-full bg-transparent text-foreground text-[0.8125rem] font-light p-3 pr-10 resize-none outline-none placeholder:text-[#BBBBBB]"
                    style={{ fontFamily: FONT_RALEWAY }}
                  />
                  <button
                    onClick={handleSendMessage}
                    disabled={sendingMessage || !message.trim()}
                    className="absolute top-3 right-3 transition-opacity hover:opacity-70 disabled:opacity-40"
                  >
                    <Send className="w-5 h-5" style={{ color: GREEN }} />
                  </button>
                </div>
                <p
                  className="text-[0.625rem] italic font-extralight text-foreground pl-1"
                  style={{ fontFamily: FONT_RALEWAY }}
                >
                  Send seller a message
                </p>
              </div>
            </div>
          )}

          {/* Own item note */}
          {isOwn && (
            <div
              className="text-center text-sm py-3 rounded-xl"
              style={{ background: "var(--c-card2)", color: FADED, fontFamily: FONT_RALEWAY }}
            >
              This is your listing
            </div>
          )}
        </div>
      </div>

      {/* ════ BOTTOM — Other Items You May Like ════ */}
      {relatedItems.length > 0 && (
        <div className="px-4 pb-10">
          {/* Section title */}
          <h2
            className="text-lg mb-4"
            style={{ fontFamily: FONT_PACIFICO, color: "var(--c-text)", fontWeight: 400 }}
          >
            Other Items You May Like
          </h2>

          {/* 4-col grid — same card style as the marketplace listing */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {relatedItems.map((related) => (
              <RelatedCard
                key={related.id}
                item={related}
                formatPrice={formatPrice}
                onClick={() => router.push(`/marketplace/${related.id}`)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Related item card ─────────────────────────────────────────── */
function RelatedCard({
  item,
  formatPrice,
  onClick,
}: {
  item: PostType;
  formatPrice: (p?: number | null) => string;
  onClick: () => void;
}) {
  const [imgError, setImgError] = useState(false);
  const imageUrl = !imgError && item.image_urls?.[0] ? item.image_urls[0] : null;

  return (
    <button
      className="text-left rounded-xl overflow-hidden transition-transform hover:scale-[1.02] hover:shadow-2xl w-full"
      style={{ background: CARD_BG }}
      onClick={onClick}
    >
      {/* Image */}
      <div className="relative w-full" style={{ height: "150px" }}>
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={item.title || item.text || "Item"} fill sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            className="object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center"
            style={{ background: "var(--c-card2)" }}
          >
            <ShoppingBag className="w-8 h-8" style={{ color: GREEN, opacity: 0.4 }} />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-2.5">
        <p
          className="text-[0.8125rem] text-foreground line-clamp-1 mb-1"
          style={{ fontFamily: FONT_RALEWAY, fontWeight: 500 }}
        >
          {item.title || item.text || "Untitled"}
        </p>
        <p
          className="text-[1.375rem] font-bold"
          style={{ fontFamily: FONT_RALEWAY, color: GREEN }}
        >
          {formatPrice(item.price)}
        </p>
      </div>
    </button>
  );
}
