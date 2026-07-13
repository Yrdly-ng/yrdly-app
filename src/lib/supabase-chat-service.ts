import { supabase } from '@/lib/supabase';
import { ChatMessage, ItemChat, ChatParticipant } from '@/types/chat';

export class SupabaseChatService {
  // Create or get existing chat for an item
  static async getOrCreateChat(
    itemId: string,
    buyerId: string,
    sellerId: string,
    itemTitle: string,
    itemImageUrl: string,
    itemPrice?: number
  ): Promise<string> {
    try {
      // Check if chat already exists
      const { data: existingChats, error: fetchError } = await supabase
        .from('item_chats')
        .select('*')
        .eq('item_id', itemId)
        .eq('buyer_id', buyerId)
        .eq('seller_id', sellerId)
        .limit(1);

      if (fetchError) {
        console.error('Error fetching existing chat:', fetchError);
        throw fetchError;
      }

      if (existingChats && existingChats.length > 0) {
        return existingChats[0].id;
      }

      // Create new chat
      const newChatData: Record<string, unknown> = {
        item_id: itemId,
        buyer_id: buyerId,
        seller_id: sellerId,
        item_title: itemTitle,
        item_image_url: itemImageUrl,
        created_at: new Date().toISOString(),
        last_message_at: new Date().toISOString(),
      };
      if (itemPrice !== undefined) {
        newChatData.item_price = itemPrice;
      }

      const { data: newChat, error: createError } = await supabase
        .from('item_chats')
        .insert(newChatData)
        .select('id')
        .single();

      if (createError) {
        console.error('Error creating chat:', createError);
        throw createError;
      }

      // Also create conversation in conversations table
      const { error: conversationCreateError } = await supabase
        .from('conversations')
        .insert({
          id: newChat.id, // Use the same ID as item_chats
          type: 'marketplace',
          participant_ids: [buyerId, sellerId],
          item_title: itemTitle,
          item_image: itemImageUrl,
          item_price: null, // This would need to be passed as a parameter if needed
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });

      if (conversationCreateError) {
        console.error('Error creating conversation:', conversationCreateError);
        // Don't throw here, the chat was created successfully
      }

      return newChat.id;
    } catch (error) {
      console.error('Error in getOrCreateChat:', error);
      throw error;
    }
  }

  // Get all chats for a user (as buyer)
  static async getUserChats(userId: string): Promise<ItemChat[]> {
    try {
      const { data: chats, error } = await supabase
        .from('item_chats')
        .select('*')
        .eq('buyer_id', userId)
        .order('last_message_at', { ascending: false });

      if (error) {
        console.error('Error fetching user chats:', error);
        throw error;
      }

      return (chats || []).map(chat => ({
        id: chat.id,
        itemId: chat.item_id,
        buyerId: chat.buyer_id,
        sellerId: chat.seller_id,
        itemTitle: chat.item_title,
        itemImageUrl: chat.item_image_url,
        itemPrice: chat.item_price ?? undefined,
        createdAt: new Date(chat.created_at),
        lastActivity: new Date(chat.last_message_at),
        isActive: true,
        updatedAt: new Date(chat.last_message_at),
        lastMessage: chat.last_message ? {
          id: '',
          chatId: chat.id,
          senderId: '',
          senderName: '',
          content: chat.last_message,
          timestamp: new Date(chat.last_message_at),
          isRead: false,
          messageType: 'text' as const,
        } : undefined,
      }));
    } catch (error) {
      console.error('Error in getUserChats:', error);
      throw error;
    }
  }

  // Get all chats for a user (as seller)
  static async getSellerChats(userId: string): Promise<ItemChat[]> {
    try {
      const { data: chats, error } = await supabase
        .from('item_chats')
        .select('*')
        .eq('seller_id', userId)
        .order('last_message_at', { ascending: false });

      if (error) {
        console.error('Error fetching seller chats:', error);
        throw error;
      }

      return (chats || []).map(chat => ({
        id: chat.id,
        itemId: chat.item_id,
        buyerId: chat.buyer_id,
        sellerId: chat.seller_id,
        itemTitle: chat.item_title,
        itemImageUrl: chat.item_image_url,
        itemPrice: chat.item_price ?? undefined,
        createdAt: new Date(chat.created_at),
        lastActivity: new Date(chat.last_message_at),
        isActive: true,
        updatedAt: new Date(chat.last_message_at),
        lastMessage: chat.last_message ? {
          id: '',
          chatId: chat.id,
          senderId: '',
          senderName: '',
          content: chat.last_message,
          timestamp: new Date(chat.last_message_at),
          isRead: false,
          messageType: 'text' as const,
        } : undefined,
      }));
    } catch (error) {
      console.error('Error in getSellerChats:', error);
      throw error;
    }
  }

  // Get messages for a specific chat
  static async getChatMessages(chatId: string): Promise<ChatMessage[]> {
    try {
      const { data: messages, error } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Error fetching chat messages:', error);
        throw error;
      }

      return (messages || []).map((message: any) => ({
        id: message.id,
        chatId: message.chat_id,
        senderId: message.sender_id,
        senderName: message.sender_name,
        content: message.content,
        timestamp: new Date(message.created_at || message.timestamp),
        // Parse isRead from metadata
        isRead: message.metadata?.isRead || false,
        messageType: (message.message_type || 'text') as 'text' | 'image' | 'system',
        metadata: message.metadata || (message.message_type === 'image' ? { imageUrl: message.content } : undefined),
      }));
    } catch (error) {
      console.error('Error in getChatMessages:', error);
      throw error;
    }
  }

  // Send a message
  static async sendMessage(
    chatId: string,
    senderId: string,
    senderName: string,
    content: string,
    imageUrl?: string
  ): Promise<void> {
    try {
      // Insert the message
      // Note: chat_messages table doesn't have is_read or image_url columns
      // image_url should be stored in metadata if needed
      const messageData: any = {
        chat_id: chatId,
        sender_id: senderId,
        sender_name: senderName,
        content: content,
        message_type: imageUrl ? 'image' : 'text',
        metadata: imageUrl ? { imageUrl } : {},
        created_at: new Date().toISOString(),
      };
      
      const { error: messageError } = await supabase
        .from('chat_messages')
        .insert(messageData);

      if (messageError) {
        console.error('Error sending message:', messageError);
        throw messageError;
      }
      
      // ALSO insert into the new `messages` table for unified inbox
      const { error: unifiedMessageError } = await supabase
        .from('messages')
        .insert({
          conversation_id: chatId,
          sender_id: senderId,
          text: content,
          image_url: imageUrl || null,
          video_url: null,
          created_at: new Date().toISOString(),
          is_read: true,
          read_by: [senderId]
        });
        
      if (unifiedMessageError) {
        console.error('Error sending unified message:', unifiedMessageError);
        // Don't throw, it's just for the unified inbox
      }

      // Update the chat's last message
      const { error: updateError } = await supabase
        .from('item_chats')
        .update({
          last_message: content,
          last_message_at: new Date().toISOString(),
        })
        .eq('id', chatId);

      if (updateError) {
        console.error('Error updating chat last message:', updateError);
        // Don't throw here, message was sent successfully
      }

      // Also update the conversations table for marketplace chats
      const { error: conversationUpdateError } = await supabase
        .from('conversations')
        .update({
          last_message_text: content,
          last_message_timestamp: new Date().toISOString(),
          last_message_sender_id: senderId,
          updated_at: new Date().toISOString()
        })
        .eq('id', chatId)
        .eq('type', 'marketplace');

      if (conversationUpdateError) {
        console.error('Error updating conversation last message:', conversationUpdateError);
        // Don't throw here, message was sent successfully
      }

      // Fire push notification to the recipient (non-sender participant)
      try {
        const { data: chatRow } = await supabase
          .from('item_chats')
          .select('buyer_id, seller_id')
          .eq('id', chatId)
          .single();

        if (chatRow) {
          const toUserId = chatRow.buyer_id === senderId ? chatRow.seller_id : chatRow.buyer_id;
          const { NotificationTriggers } = await import('@/lib/notification-triggers');
          await NotificationTriggers.onMessageSent(
            toUserId,
            senderId,
            chatId,
            imageUrl ? '📷 Photo' : content
          );
        }
      } catch (notifError) {
        console.error('Error firing marketplace message notification:', notifError);
        // Non-fatal: message was already sent successfully
      }
    } catch (error) {
      console.error('Error in sendMessage:', error);
      throw error;
    }
  }

  // Subscribe to chat messages
  static subscribeToChat(chatId: string, callback: (messages: ChatMessage[]) => void) {
    const channel = supabase
      .channel(`chat-${chatId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chat_messages',
          filter: `chat_id=eq.${chatId}`,
        },
        async () => {
          // Refetch messages when changes occur
          try {
            const messages = await this.getChatMessages(chatId);
            callback(messages);
          } catch (error) {
            console.error('Error refetching messages:', error);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }

  // Mark messages as read using the metadata column
  static async markMessagesAsRead(chatId: string, userId: string): Promise<void> {
    try {
      // Fetch messages sent by the OTHER person
      const { data: messages, error: fetchError } = await supabase
        .from('chat_messages')
        .select('id, metadata')
        .eq('chat_id', chatId)
        .neq('sender_id', userId);

      if (fetchError) throw fetchError;
      if (!messages || messages.length === 0) return;

      // Filter for unread messages
      const unreadMessages = messages.filter(m => !m.metadata || !m.metadata.isRead);
      if (unreadMessages.length === 0) return;

      // Update their metadata
      const updatePromises = unreadMessages.map(msg => {
        const newMetadata = { ...(msg.metadata || {}), isRead: true };
        return supabase
          .from('chat_messages')
          .update({ metadata: newMetadata })
          .eq('id', msg.id);
      });

      await Promise.all(updatePromises);
    } catch (error) {
      console.error('Error in markMessagesAsRead:', error);
      throw error;
    }
  }
}
