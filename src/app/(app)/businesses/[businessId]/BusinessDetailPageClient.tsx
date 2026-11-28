"use client";

import { BusinessDetailScreen } from "@/components/businesses/BusinessDetailScreen";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/supabase";
import { useAuth } from "@/hooks/use-supabase-auth";
import type { Business } from "@/types";
import { getBusinessLogo } from "@/lib/businesses/presentation";
import { authenticatedFetch } from "@/lib/auth/authenticated-fetch";

export default function BusinessDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const businessId = params.businessId as string;
  const [business, setBusiness] = useState<Business | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const revision = useRef(0);

  const fetchBusiness = useCallback(async () => {
    if (!businessId) return;
    const request = ++revision.current;
    setError("");
    try {
      let businessQuery = supabase
        .from("businesses")
        // Only public presentation fields are returned to the browser.
        .select(
          "id, name, category, description, location, image_urls, created_at, state, lga, ward, rating, review_count, hours, phone, email, website, owner_name, owner_avatar, cover_image, logo, logo_url, mode, is_active, verified_seller, is_verified"
        )
        .eq("id", businessId);
      if (!user) {
        businessQuery = businessQuery
          .eq("is_active", true)
          .eq("moderation_status", "approved")
          .eq("is_flagged", false);
      }
      const { data: businessData, error: businessError } = await businessQuery.maybeSingle();

      if (request !== revision.current) return;
      if (businessError) throw businessError;
      if (!businessData) {
        setBusiness(null);
        return;
      }

      const viewerContext = user
        ? await authenticatedFetch<{
            isOwner: boolean;
            ownerName?: string | null;
            ownerAvatar?: string | null;
          }>("/api/businesses/viewer-context", { businessId })
        : { isOwner: false, ownerName: null, ownerAvatar: null };
      const isOwner = viewerContext.isOwner;
      if (!businessData.is_active && !isOwner) {
        setBusiness(null);
        return;
      }

      const business: Business = {
        id: businessData.id,
        // Only the current owner receives their own ID for owner-only UI checks.
        owner_id: isOwner && user ? user.id : "",
        name: businessData.name,
        category: businessData.category,
        description: businessData.description,
        location: businessData.location,
        image_urls: businessData.image_urls,
        created_at: businessData.created_at,
        state: businessData.state,
        lga: businessData.lga,
        ward: businessData.ward,
        rating: businessData.rating || 0,
        review_count: businessData.review_count || 0,
        hours: businessData.hours || "Hours not specified",
        phone: businessData.phone,
        email: businessData.email,
        website: businessData.website,
        mode: businessData.mode || "product",
        owner_name:
          viewerContext.ownerName || businessData.owner_name || "Unknown Owner",
        owner_avatar: viewerContext.ownerAvatar || businessData.owner_avatar,
        cover_image: businessData.cover_image || businessData.image_urls?.[0],
        logo: getBusinessLogo(businessData) ?? undefined,
        verified_seller:
          businessData.verified_seller || businessData.is_verified || false,
        catalog: [],
      };

      if (request === revision.current) setBusiness(business);
    } catch (error) {
      console.error("Error fetching business:", error);
      if (request === revision.current)
        setError("We couldn’t load this business. Please try again.");
    } finally {
      if (request === revision.current) setLoading(false);
    }
  }, [businessId, user?.id]);

  useEffect(() => {
    setBusiness(null);
    setLoading(true);
    void fetchBusiness();
    return () => {
      revision.current++;
    };
  }, [fetchBusiness]);

  useEffect(() => {
    if (!businessId) return;
    const channel = supabase
      .channel(
        `business-detail:${businessId}:${Math.random().toString(36).slice(2)}`,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "businesses",
          filter: `id=eq.${businessId}`,
        },
        () => fetchBusiness(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [businessId, fetchBusiness]);

  const handleMessageOwner = (business: Business, item?: any) => {
    if (item) {
      router.push(`/businesses/${businessId}/catalog/${item.id}/chat`);
    } else {
      router.push(`/businesses/${businessId}/chat`);
    }
  };

  const handleViewCatalogItem = (item: any) => {
    router.push(`/businesses/${businessId}/catalog/${item.id}`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[100dvh]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading business...</p>
        </div>
      </div>
    );
  }

  if (!business) {
    return (
      <div className="p-4 text-center">
        <h2 className="text-xl font-semibold text-foreground mb-2">
          {error ? "Couldn’t load this business" : "Business not found"}
        </h2>
        <p className="text-muted-foreground mb-4">
          The business you&apos;re looking for doesn&apos;t exist or has been
          removed.
        </p>
        {error && (
          <button
            onClick={() => void fetchBusiness()}
            className="mr-3 rounded-xl border border-border px-4 py-2"
          >
            Try again
          </button>
        )}
        <button
          onClick={() => {
            if (window.history.length > 2) {
              window.history.back();
            } else {
              router.push("/businesses");
            }
          }}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
        >
          Back
        </button>
      </div>
    );
  }

  return (
    <BusinessDetailScreen
      key={business.id}
      business={business}
      onBusinessUpdated={fetchBusiness}
      onBusinessDeleted={() => {
        setBusiness(null);
        router.push("/businesses");
      }}
      onBack={() => {
        if (business?.category) {
          router.push(
            `/businesses?category=${encodeURIComponent(business.category)}`,
          );
        } else {
          router.push("/businesses");
        }
      }}
      onMessageOwner={handleMessageOwner}
      onViewCatalogItem={handleViewCatalogItem}
    />
  );
}
