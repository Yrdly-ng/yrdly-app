"use client";

import { BusinessChatScreen } from "@/components/messages/BusinessChatScreen";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/supabase";
import { useAuth } from "@/hooks/use-supabase-auth";
import type { Business } from "@/types";
import { getBusinessLogo } from "@/lib/businesses/presentation";
import { authenticatedFetch } from "@/lib/auth/authenticated-fetch";

export default function BusinessChatPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const businessId = params.businessId as string;
  const [business, setBusiness] = useState<Business | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!businessId) return;

    const fetchBusiness = async () => {
      try {
        const { data, error } = await supabase
          .from('businesses')
          // Limit the browser response to business detail fields required by this page; omit admin and moderation metadata.
          .select(
            "id, name, category, description, location, image_urls, created_at, rating, review_count, hours, phone, email, website, owner_name, owner_avatar, cover_image, logo, logo_url, is_active"
          )
          .eq('id', businessId)
          .eq('is_active', true)
          .eq('moderation_status', 'approved')
          .eq('is_flagged', false)
          .single();

        if (error) {
          console.error('Error fetching business:', error);
          return;
        }

        if (data) {
          const businessData: Business = {
            id: data.id,
            owner_id: "",
            name: data.name,
            category: data.category,
            description: data.description,
            location: data.location,
            image_urls: data.image_urls,
            created_at: data.created_at,
            rating: data.rating || 0,
            review_count: data.review_count || 0,
            hours: data.hours || "Hours not specified",
            phone: data.phone,
            email: data.email,
            website: data.website,
            owner_name: data.owner_name || "Unknown Owner",
            owner_avatar: data.owner_avatar,
            cover_image: data.cover_image || data.image_urls?.[0],
            logo: getBusinessLogo(data) ?? undefined,
            distance: "0.5 km away",
            catalog: []
          };
          setBusiness(businessData);
        }
      } catch (error) {
        console.error('Error fetching business:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchBusiness();
  }, [businessId]);

  const handleBack = () => {
    if (window.history.length > 2) {
      window.history.back();
    } else {
      router.push(`/businesses/${businessId}`);
    }
  };

  const [conversationId, setConversationId] = useState<string | null>(null);

  // Resolve the business owner and create/reuse the conversation server-side.
  // The browser receives only the conversation ID, never the private owner_id.
  useEffect(() => {
    if (!business || !user) return;
    let cancelled = false;
    authenticatedFetch<{ conversationId: string }>('/api/businesses/conversations', {
      businessId,
    }).then(({ conversationId: id }) => {
      if (!cancelled) setConversationId(id);
    }).catch(error => {
      console.error('Error opening business conversation:', error);
    });
    return () => { cancelled = true; };
  }, [business, user, businessId]);

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

  if (!business) {
    return (
      <div className="p-4 text-center">
        <h2 className="text-xl font-semibold text-foreground mb-2">Business not found</h2>
        <p className="text-muted-foreground mb-4">The business you&apos;re trying to chat with doesn&apos;t exist.</p>
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
    <BusinessChatScreen
      business={business}
      conversationId={conversationId || undefined}
      onBack={handleBack}
    />
  );
}
