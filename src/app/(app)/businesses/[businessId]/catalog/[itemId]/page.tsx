"use client";

import { CatalogItemScreen } from "@/components/CatalogItemScreen";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Business, CatalogItem } from "@/types";

export default function CatalogItemPage() {
  const params = useParams();
  const router = useRouter();
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
          .select('*')
          .eq('id', businessId)
          .single();

        if (businessError) {
          console.error('Error fetching business:', businessError);
          return;
        }

        // Fetch catalog item data
        const { data: itemData, error: itemError } = await supabase
          .from('catalog_items')
          .select('*')
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
            owner_id: businessData.owner_id,
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
            cover_image: businessData.image_urls?.[0],
            logo: businessData.image_urls?.[0],
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

  const handleMessageOwner = (item?: CatalogItem) => {
    router.push(`/businesses/${businessId}/catalog/${itemId}/chat`);
  };

  const handleBack = () => {
    router.push(`/businesses/${businessId}`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[100dvh]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading item...</p>
        </div>
      </div>
    );
  }

  if (!business || !catalogItem) {
    return (
      <div className="p-4 text-center">
        <h2 className="text-xl font-semibold text-foreground mb-2">Item not found</h2>
        <p className="text-muted-foreground mb-4">The item you&apos;re looking for doesn&apos;t exist or has been removed.</p>
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
    <CatalogItemScreen
      business={business}
      item={catalogItem}
      onBack={handleBack}
      onMessageOwner={handleMessageOwner}
    />
  );
}
