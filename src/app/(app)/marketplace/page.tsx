
"use client";

import { MarketplaceScreen } from "@/components/MarketplaceScreen";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import type { Post as PostType } from "@/types";
import posthog from "posthog-js";

export default function MarketplacePage() {
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();

  const handleItemClick = (item: PostType) => {
    posthog.capture('marketplace_item_clicked', {
      item_id: item.id,
      item_title: item.title || item.text,
      item_price: item.price,
    });
    router.push(`/marketplace/${item.id}`);
  };

  const handleMessageSeller = async (item: PostType) => {
    if (!user || !item.user_id || user.id === item.user_id) {
      if (user?.id === item.user_id) {
        toast({
          variant: "destructive",
          title: "Error",
          description: "You cannot message yourself",
        });
      }
      return;
    }

    try {
      // Check if item-specific conversation already exists
      const { data: existingConversations, error: fetchError } = await supabase
        .from('conversations')
        .select('id, participant_ids, item_id')
        .contains('participant_ids', [user.id])
        .eq('type', 'marketplace')
        .eq('item_id', item.id);

      if (fetchError) {
        console.error("Error fetching conversations:", fetchError);
        toast({ 
          variant: "destructive", 
          title: "Error", 
          description: "Could not open conversation." 
        });
        return;
      }
      
      let conversationId: string;

      if (!existingConversations || existingConversations.length === 0) {
        // Create new item-specific conversation
        const sortedParticipantIds = [user.id, item.user_id].sort();
        const { data: newConv, error: createError } = await supabase
          .from('conversations')
          .insert({
            participant_ids: sortedParticipantIds,
            type: 'marketplace',
            item_id: item.id,
            item_title: item.title || item.text || "Item",
            item_image: item.image_url || item.image_urls?.[0] || "/placeholder.svg",
            item_price: item.price || 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .select('id')
          .single();

        if (createError) throw createError;
        conversationId = newConv.id;
      } else {
        conversationId = existingConversations[0].id;
      }

      posthog.capture('marketplace_seller_messaged', {
        item_id: item.id,
        item_title: item.title || item.text,
        item_price: item.price,
        seller_id: item.user_id,
      });

      // Navigate to the conversation
      router.push(`/messages/${conversationId}`);
    } catch (error) {
      console.error("Error creating conversation:", error);
      toast({ 
        variant: "destructive", 
        title: "Error", 
        description: "Could not open conversation." 
      });
    }
  };

  return (
    <MarketplaceScreen 
      onItemClick={handleItemClick}
      onMessageSeller={handleMessageSeller}
    />
  );
}
