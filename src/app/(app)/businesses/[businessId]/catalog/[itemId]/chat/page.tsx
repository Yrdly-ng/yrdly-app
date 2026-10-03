"use client";

import { BusinessChatScreen } from "@/components/BusinessChatScreen";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-supabase-auth";
import type { Business, CatalogItem } from "@/types";

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

  const [conversationId, setConversationId] = useState<string | null>(null);

  // Create or get conversation entry for catalog item chat
  // Use ref to prevent multiple simultaneous creations
  const conversationCreationRef = useRef(false);
  
  useEffect(() => {
    if (!business || !catalogItem || !user) return;
    
    // Prevent duplicate creation attempts
    if (conversationCreationRef.current) return;
    conversationCreationRef.current = true;

    const createOrGetConversation = async () => {
      try {
        const { data: existingConversations, error: fetchError } = await supabase
          .from('conversations')
          .select('id, participant_ids, context')
          .contains('participant_ids', [user.id])
          .eq('type', 'business')
          .eq('business_id', businessId);
        
        if (fetchError) {
          console.error('Error fetching catalog item conversations:', fetchError);
          conversationCreationRef.current = false;
          return;
        }

        const matchingConversations = existingConversations?.filter(conv => {
          const context = conv.context as { catalog_item_id?: string } | null;
          return context?.catalog_item_id === itemId;
        }) || [];

        if (matchingConversations.length > 0) {
          setConversationId(matchingConversations[0].id);
          conversationCreationRef.current = false;
          return;
        }

        if (matchingConversations.length === 0) {
          const insertData = {
            participant_ids: [user.id, business.owner_id],
            type: 'business' as const,
            business_id: businessId,
            business_name: business.name,
            business_logo: business.logo,
            item_id: null,
            item_title: catalogItem.title,
            item_image: catalogItem.images?.[0] || "/placeholder.svg",
            item_price: catalogItem.price,
            context: {
              catalog_item_id: itemId,
              catalog_item_business_id: businessId
            },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          
          const { data: newConv, error: createError } = await supabase
            .from('conversations')
            .insert(insertData)
            .select('id')
            .single();

          if (createError) {
            console.error('Error creating catalog item conversation:', createError);
            conversationCreationRef.current = false;
          } else if (newConv) {
            setConversationId(newConv.id);
            conversationCreationRef.current = false;
          }
        }
      } catch (error) {
        console.error('Error in createOrGetConversation:', error);
        conversationCreationRef.current = false;
      }
    };

    createOrGetConversation();
    
    return () => {
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
