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

/* ─── colour tokens matching the Figma ─────────────────────────── */
const BG = "#15181D";
const CARD_BG = "#1E2126";
const GREEN = "#388E3C";
const FADED = "#BBBBBB";
const FONT_RALEWAY = "Raleway, sans-serif";
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

        /* fetch related items (other For Sale posts, exclude current) */
        const { data: related } = await supabase
          .from("posts")
          .select(`*, user:users!posts_user_id_fkey(id, name, avatar_url)`)
          .eq("category", "For Sale")
          .eq("is_sold", false)
          .neq("id", itemId)
          .order("timestamp", { ascending: false })
          .limit(4);

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
      <div className="min-h-screen p-4" style={{ background: BG }}>
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
    <div className="min-h-screen" style={{ background: BG }}>

      {/* ── Back button row ── */}
      <div className="px-4 pt-4 pb-2">
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
              borderBottom: "0.2px solid rgba(255,255,255,0.1)",
            }}
          >
            <h1
              className="text-2xl font-extrabold text-white leading-tight"
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
                  alt={item.title || "Item image"}
                  fill
                  className="object-cover"
                />
              ) : (
                <div
                  className="w-full h-full flex items-center justify-center"
                  style={{ background: "#252B35" }}
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
                    style={{ background: i === currentImageIndex ? "#FFFFFF" : FADED }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="mx-6 my-4" style={{ borderTop: "0.2px solid rgba(255,255,255,0.2)" }} />

          {/* Details section */}
          <div className="px-6 pb-4">
            <p
              className="font-bold text-[13px] text-white mb-2"
              style={{ fontFamily: FONT_RALEWAY }}
            >
              Details
            </p>
            <p
              className="text-[13px] text-white leading-[18px]"
              style={{ fontFamily: FONT_RALEWAY, fontWeight: 400 }}
            >
              {item.description || item.text || "No description provided."}
            </p>
          </div>

          {/* Divider */}
          <div className="mx-6 my-4" style={{ borderTop: "0.2px solid rgba(255,255,255,0.2)" }} />

          {/* Directions / location */}
          <div className="px-6 pb-6">
            <p
              className="font-bold text-[13px] text-white mb-3"
              style={{ fontFamily: FONT_RALEWAY }}
            >
              Directions
            </p>
            {item.lga || item.state ? (
              <div
                className="flex items-center gap-2 px-3 py-3 rounded-xl text-sm"
                style={{ background: "#252B35", color: FADED, fontFamily: FONT_RALEWAY }}
              >
                <MapPin className="w-4 h-4" style={{ color: GREEN }} />
                <span>{[item.lga, item.state].filter(Boolean).join(", ")}</span>
              </div>
            ) : (
              <div
                className="flex items-center gap-2 px-3 py-3 rounded-xl text-sm"
                style={{ background: "#252B35", color: FADED, fontFamily: FONT_RALEWAY }}
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
            className="text-[24px] font-bold leading-[28px]"
            style={{ fontFamily: FONT_RALEWAY, color: GREEN }}
          >
            {formatPrice(item.price)}
          </p>

          {/* Buy Now button — shown only to non-owners with a priced item */}
          {!isOwn && item.price && item.price > 0 && (
            <BuyButton
              itemId={item.id}
              itemTitle={item.title || item.text || "Item"}
              itemImageUrl={images[0]}
              price={item.price}
              condition="Used"
              sellerId={item.user_id}
              sellerName={item.author_name || "Seller"}
            />
          )}

          {/* Horizontal divider */}
          <div style={{ borderTop: "0.2px solid rgba(255,255,255,0.2)" }} />

          {/* Seller Information */}
          <div>
            <p
              className="font-bold text-[13px] text-white mb-3"
              style={{ fontFamily: FONT_RALEWAY }}
            >
              Seller Information
            </p>
            <button
              className="flex items-center gap-3 hover:opacity-80 transition-opacity w-full text-left"
              onClick={() => router.push(`/profile/${item.user_id}`)}
            >
              <div className="w-9 h-9 rounded-full overflow-hidden flex-shrink-0 flex items-center justify-center text-xs font-bold text-white"
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
                  className="text-[13px] font-normal text-white"
                  style={{ fontFamily: FONT_RALEWAY }}
                >
                  {item.author_name || "Unknown Seller"}
                </p>
                <p
                  className="text-[10px] italic font-extralight text-white"
                  style={{ fontFamily: FONT_RALEWAY }}
                >
                  Joined Yrdly in {new Date(item.user?.created_at || item.timestamp).getFullYear()}
                </p>
              </div>
            </button>
          </div>

          {/* Horizontal divider */}
          <div style={{ borderTop: "0.2px solid rgba(255,255,255,0.2)" }} />

          {/* Message box (only for non-owners) */}
          {!isOwn && (
            <div className="flex items-start gap-3">
              {/* Current user avatar */}
              <div
                className="w-9 h-9 rounded-full overflow-hidden flex-shrink-0 flex items-center justify-center text-xs font-bold text-white mt-1"
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
                    className="w-full bg-transparent text-white text-[13px] font-light p-3 pr-10 resize-none outline-none placeholder:text-[#BBBBBB]"
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
                  className="text-[10px] italic font-extralight text-white pl-1"
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
              style={{ background: "#252B35", color: FADED, fontFamily: FONT_RALEWAY }}
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
            style={{ fontFamily: FONT_PACIFICO, color: "#FFFFFF", fontWeight: 400 }}
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
            alt={item.title || item.text || "Item"}
            fill
            className="object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center"
            style={{ background: "#252B35" }}
          >
            <ShoppingBag className="w-8 h-8" style={{ color: GREEN, opacity: 0.4 }} />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-2.5">
        <p
          className="text-[13px] text-white line-clamp-1 mb-1"
          style={{ fontFamily: FONT_RALEWAY, fontWeight: 500 }}
        >
          {item.title || item.text || "Untitled"}
        </p>
        <p
          className="text-[22px] font-bold"
          style={{ fontFamily: FONT_RALEWAY, color: GREEN }}
        >
          {formatPrice(item.price)}
        </p>
      </div>
    </button>
  );
}
