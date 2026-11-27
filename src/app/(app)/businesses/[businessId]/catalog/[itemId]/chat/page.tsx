"use client";

import { BusinessChatScreen } from "@/components/messages/BusinessChatScreen";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase/supabase";
import { authenticatedFetch } from "@/lib/auth/authenticated-fetch";
import { useAuth } from "@/hooks/use-supabase-auth";
import type { Business, CatalogItem } from "@/types";
import { getBusinessLogo } from "@/lib/businesses/presentation";

export default function ItemChatPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const businessId = params.businessId as string;
  const itemId = params.itemId as string;
  const [business, setBusiness] = useState<Business | null>(null);
  const [catalogItem, setCatalogItem] = useState<CatalogItem | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!businessId || !itemId) return;

    const fetchData = async () => {
      try {
        // Fetch business data
        const { data: businessData, error: businessError } = await supabase
          .from('businesses')
          // Limit the browser response to business detail fields required by this page; omit admin and moderation metadata.
          .select(
            "id, name, category, description, location, image_urls, created_at, rating, review_count, hours, phone, email, website, owner_name, owner_avatar, cover_image, logo, logo_url, is_active"
          )
          .eq('id', businessId)
          .eq('is_active', true)
          .single();

        if (businessError) {
          console.error('Error fetching business:', businessError);
          return;
        }

        // Fetch catalog item data
        const { data: itemData, error: itemError } = await supabase
          .from('catalog_items')
          .select('id, business_id, title, description, price, images, category, in_stock, created_at, updated_at')
          .eq('id', itemId)
          .eq('business_id', businessId)
          .single();

        if (itemError) {
          console.error('Error fetching catalog item:', itemError);
          return;
        }

        if (businessData) {
          const businessInfo: Business = {
            id: businessData.id,
            name: businessData.name,
            category: businessData.category,
            description: businessData.description,
            location: businessData.location,
            image_urls: businessData.image_urls,
            created_at: businessData.created_at,
            rating: businessData.rating || 0,
            review_count: businessData.review_count || 0,
            hours: businessData.hours || "Hours not specified",
            phone: businessData.phone,
            email: businessData.email,
            website: businessData.website,
            owner_name: businessData.owner_name || "Unknown Owner",
            owner_avatar: businessData.owner_avatar,
            cover_image: businessData.cover_image || businessData.image_urls?.[0],
            logo: getBusinessLogo(businessData) ?? undefined,
            distance: "0.5 km away",
            catalog: []
          };
          setBusiness(businessInfo);
        }

        if (itemData) {
          setCatalogItem(itemData);
        }
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [businessId, itemId]);

  const [conversationId, setConversationId] = useState<string | null>(null);

  // Conversation creation and owner resolution happen on the server.
  // This avoids exposing businesses.owner_id in the public browser projection.
  const conversationCreationRef = useRef(false);

  useEffect(() => {
    if (!business || !catalogItem || !user || conversationCreationRef.current) return;
    let cancelled = false;
    conversationCreationRef.current = true;
    authenticatedFetch<{ conversationId: string }>('/api/businesses/conversations', {
      businessId,
      itemId,
    }).then(({ conversationId: id }) => {
      if (!cancelled) setConversationId(id);
    }).catch(error => {
      console.error('Error opening catalog item conversation:', error);
    }).finally(() => {
      conversationCreationRef.current = false;
    });
    return () => {
      cancelled = true;
      conversationCreationRef.current = false;
    };
  }, [business, catalogItem, user, businessId, itemId]);

  const handleBack = () => {
    if (window.history.length > 2) {
      window.history.back();
    } else {
      router.push(`/businesses/${businessId}/catalog/${itemId}`);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[100dvh]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading chat...</p>
        </div>
      </div>
    );
  }

  if (!business || !catalogItem) {
    return (
      <div className="p-4 text-center">
        <h2 className="text-xl font-semibold text-foreground mb-2">Item not found</h2>
        <p className="text-muted-foreground mb-4">The item you&apos;re trying to chat about doesn&apos;t exist.</p>
        <button 
          onClick={() => router.push(`/businesses/${businessId}`)}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
        >
          Back to Business
        </button>
      </div>
    );
  }

  return (
    <BusinessChatScreen
      business={business}
      item={catalogItem}
      conversationId={conversationId || undefined}
      onBack={handleBack}
    />
  );
}
