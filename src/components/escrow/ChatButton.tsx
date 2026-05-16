"use client";

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-supabase-auth';
import { ChatService } from '@/lib/chat-service';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { MessageCircle } from 'lucide-react';

interface ChatButtonProps {
  itemId: string;
  itemTitle: string;
  itemImageUrl: string;
  sellerId: string;
  sellerName: string;
  itemPrice?: number;
}

export function ChatButton({ itemId, itemTitle, itemImageUrl, sellerId, sellerName, itemPrice }: ChatButtonProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const handleOpenChat = async () => {
    if (!user) {
      toast({
        title: "Error",
        description: "Please log in to chat with sellers",
        variant: "destructive",
      });
      return;
    }

    if (user.id === sellerId) {
      toast({
        title: "Error",
        description: "You cannot chat with yourself",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      // Get or create chat with the specific seller
      const chatId = await ChatService.getOrCreateChat(
        itemId,
        user.id,
        sellerId,
        itemTitle,
        itemImageUrl,
        itemPrice
      );

      // Redirect to the specific chat
      router.push(`/messages/marketplace/${chatId}`);
    } catch (error) {
      console.error('Failed to open chat:', error);
      toast({
        title: "Error",
        description: "Failed to open chat. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Button
      variant="outline"
      className="w-full border-gray-300 hover:bg-gray-50"
      onClick={handleOpenChat}
      disabled={isLoading}
    >
      <MessageCircle className="w-4 h-4 mr-2" />
      {isLoading ? 'Opening...' : 'Chat with Seller'}
    </Button>
  );
}
