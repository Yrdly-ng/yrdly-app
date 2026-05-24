"use client";

import { BusinessChatScreen } from "@/components/BusinessChatScreen";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-supabase-auth";
import type { Business } from "@/types";

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
          .select('*')
          .eq('id', businessId)
          .single();

        if (error) {
          console.error('Error fetching business:', error);
          return;
        }

        if (data) {
          const businessData: Business = {
            id: data.id,
            owner_id: data.owner_id,
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
            cover_image: data.image_urls?.[0],
            logo: data.image_urls?.[0],
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
    router.push(`/businesses/${businessId}`);
  };

  // Create or get conversation entry for business chat
  useEffect(() => {
    if (!business || !user) return;

    const createOrGetConversation = async () => {
      try {
        // Check if conversation already exists for this business
        const { data: existingConversations, error: fetchError } = await supabase
          .from('conversations')
          .select('id, participant_ids')
          .contains('participant_ids', [user.id])
          .eq('type', 'business')
          .eq('business_id', businessId);

        if (fetchError) {
          console.error('Error fetching business conversations:', fetchError);
          return;
        }

        if (!existingConversations || existingConversations.length === 0) {
          // Create new business conversation
          const { data: newConv, error: createError } = await supabase
            .from('conversations')
            .insert({
              participant_ids: [user.id, business.owner_id],
              type: 'business',
              business_id: businessId,
              business_name: business.name,
              business_logo: business.logo,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .select('id')
            .single();

          if (createError) {
            console.error('Error creating business conversation:', createError);
          } else {
          }
        }
      } catch (error) {
        console.error('Error in createOrGetConversation:', error);
      }
    };

    createOrGetConversation();
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
      onBack={handleBack}
    />
  );
}
