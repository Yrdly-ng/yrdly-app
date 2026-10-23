"use client";

import { CatalogItemScreen } from "@/components/catalog/CatalogItemScreen";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/supabase";
import type { Business, CatalogItem } from "@/types";

export default function CatalogItemPage() {
  const params = useParams();
  const router = useRouter();
  const businessId = params.businessId as string;
  const itemId = params.itemId as string;
  const [business, setBusiness] = useState<Business | null>(null);
  const [catalogItem, setCatalogItem] = useState<CatalogItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const fetchData = useCallback(async () => {
    if (!businessId || !itemId) {
      setLoading(false);
      setError("This product link is incomplete.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [businessResult, itemResult] = await Promise.all([
        supabase
          .from("businesses")
          .select("*")
          .eq("id", businessId)
          .eq("is_active", true)
          .single(),
        supabase
          .from("catalog_items")
          .select("*")
          .eq("id", itemId)
          .eq("business_id", businessId)
          .single(),
      ]);
      if (businessResult.error) throw businessResult.error;
      if (itemResult.error) throw itemResult.error;
      const data = businessResult.data;
      setBusiness({
        ...data,
        cover_image: data.cover_image || data.image_urls?.[0],
        logo: data.logo || data.logo_url || data.image_urls?.[0],
        verified_seller: data.verified_seller || data.is_verified || false,
        catalog: [],
      });
      setCatalogItem(itemResult.data);
    } catch {
      setError(
        "We couldn’t load this product. It may have been removed, or your connection needs another try.",
      );
    } finally {
      setLoading(false);
    }
  }, [businessId, itemId]);
  useEffect(() => {
    void fetchData();
  }, [fetchData]);
  if (loading)
    return (
      <div
        role="status"
        className="mx-auto max-w-5xl p-8 text-muted-foreground"
      >
        Loading product…
      </div>
    );
  if (error || !business || !catalogItem)
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-8 font-yrdly-body">
        <h1 className="font-yrdly-display text-3xl font-bold">
          Product unavailable
        </h1>
        <p role="alert" className="text-muted-foreground">
          {error || "This product is no longer available."}
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => void fetchData()}
            className="rounded-xl bg-primary px-5 py-3 text-primary-foreground"
          >
            Try again
          </button>
          <button
            onClick={() => router.push(`/businesses/${businessId}`)}
            className="rounded-xl border border-border px-5 py-3"
          >
            Visit business
          </button>
        </div>
      </div>
    );
  return (
    <CatalogItemScreen
      business={business}
      item={catalogItem}
      onBack={() => router.push(`/businesses/${businessId}`)}
      onMessageOwner={() =>
        router.push(`/businesses/${businessId}/catalog/${itemId}/chat`)
      }
    />
  );
}
