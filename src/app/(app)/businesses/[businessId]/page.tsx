"use client";

import { BusinessDetailScreen } from "@/components/BusinessDetailScreen";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Business } from "@/types";

export default function BusinessDetailPage() {
  const params = useParams();
  const router = useRouter();
  const businessId = params.businessId as string;
  const [business, setBusiness] = useState<Business | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!businessId) return;

    const fetchBusiness = async () => {
      try {
        // First fetch the business data
        const { data: businessData, error: businessError } = await supabase
          .from('businesses')
          .select('*')
          .eq('id', businessId)
          .single();

        if (businessError) {
          console.error('Error fetching business:', businessError);
          return;
        }

        if (businessData) {
          // Then fetch the owner data separately
          let ownerData = null;
          if (businessData.owner_id) {
            const { data: userData, error: userError } = await supabase
              .from('users')
              .select('name, avatar_url')
              .eq('id', businessData.owner_id)
              .single();
            
            if (!userError && userData) {
              ownerData = userData;
            }
          }

          // Transform the data to match our Business interface
          const business: Business = {
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
            owner_name: ownerData?.name || businessData.owner_name || "Unknown Owner",
            owner_avatar: ownerData?.avatar_url || businessData.owner_avatar,
            cover_image: businessData.image_urls?.[0],
            logo: businessData.image_urls?.[0],
            distance: "0.5 km away", // This would be calculated based on user location
            catalog: [] // Will be fetched separately
          };

          setBusiness(business);
        }
      } catch (error) {
        console.error('Error fetching business:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchBusiness();
  }, [businessId]);

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
        <h2 className="text-xl font-semibold text-foreground mb-2">Business not found</h2>
        <p className="text-muted-foreground mb-4">The business you&apos;re looking for doesn&apos;t exist or has been removed.</p>
        <button 
          onClick={() => router.push('/businesses')}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
        >
          Back to Businesses
        </button>
      </div>
    );
  }

  return (
    <BusinessDetailScreen
      business={business}
      onBack={() => router.push("/businesses")}
      onMessageOwner={handleMessageOwner}
      onViewCatalogItem={handleViewCatalogItem}
    />
  );
}
