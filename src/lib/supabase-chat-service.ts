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
      // 1. Check if conversation already exists in unified conversations table
      const { data: existingConvs, error: fetchError } = await supabase
        .from('conversations')
        .select('id')
        .contains('participant_ids', [buyerId, sellerId])
        .eq('type', 'marketplace')
        .eq('item_id', itemId)
        .limit(1);

      if (!fetchError && existingConvs && existingConvs.length > 0) {
        return existingConvs[0].id;
      }

      // 3. Create new conversation in conversations table
      const { data: newConv, error: createError } = await supabase
        .from('conversations')
        .insert({
          participant_ids: [buyerId, sellerId].sort(),
          type: 'marketplace',
          item_id: itemId,
          item_title: itemTitle || 'Item',
          item_image: itemImageUrl || '',
          item_price: itemPrice ?? 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select('id')
        .single();

      if (createError) {
        console.error('Error creating conversation:', createError);
        throw createError;
      }

      return newConv.id;
    } catch (error) {
      console.error('Error in getOrCreateChat:', error);
      throw error;
    }
  }

  static async getUserChats(userId: string): Promise<ItemChat[]> { return this.listChats(userId); }
  static async getSellerChats(userId: string): Promise<ItemChat[]> { return (await this.listChats(userId)).filter(chat => chat.sellerId === userId); }
  private static async listChats(userId: string): Promise<ItemChat[]> {
    const { data,error } = await supabase.from('conversations').select('*')
      .contains('participant_ids',[userId]).eq('type','marketplace').order('last_message_timestamp',{ ascending:false });
    if (error) throw error;
    const itemIds = Array.from(new Set((data || []).map(chat => chat.item_id).filter(Boolean)));
    const { data:items,error:itemError } = itemIds.length
      ? await supabase.from('posts').select('id,user_id').in('id',itemIds) : { data:[],error:null };
    if (itemError) throw itemError;
    const sellers = new Map((items || []).map(item => [item.id,item.user_id]));
    return (data || []).map(chat => {
      const sellerId = sellers.get(chat.item_id) as string | undefined;
      return {
      id:chat.id,itemId:chat.item_id,buyerId:chat.participant_ids.find((id:string) => id !== (sellerId || userId)) || userId,
      sellerId:sellerId || userId,itemTitle:chat.item_title,itemImageUrl:chat.item_image,itemPrice:chat.item_price,
      createdAt:new Date(chat.created_at),updatedAt:new Date(chat.updated_at),lastActivity:new Date(chat.last_message_timestamp || chat.updated_at),
      isActive:true,lastMessage:chat.last_message_text ? { id:'',chatId:chat.id,senderId:chat.last_message_sender_id,
        senderName:'',content:chat.last_message_text,timestamp:new Date(chat.last_message_timestamp),isRead:false,messageType:'text' as const } : undefined,
    }; });
  }

  // Get messages for a specific chat
  static async getChatMessages(chatId: string): Promise<ChatMessage[]> {
    try {
      const { data: messages, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', chatId)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Error fetching chat messages:', error);
        throw error;
      }

      return (messages || []).map((message: any) => ({
        id: message.id,
        chatId: message.conversation_id,
        senderId: message.sender_id,
        senderName: message.sender_name,
        content: message.text || message.content || '',
        timestamp: new Date(message.created_at || message.timestamp),
        // Parse isRead from metadata
        isRead: (message.read_by?.length || 0) > 1,
        messageType: (message.image_url ? 'image' : 'text') as 'text' | 'image' | 'system',
        metadata: message.image_url ? { imageUrl:message.image_url } : undefined,
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
      const { error:messageError } = await supabase.from('messages').insert({
        conversation_id:chatId,sender_id:senderId,text:content,image_url:imageUrl || null,
        created_at:new Date().toISOString(),is_read:true,read_by:[senderId],
      });
      if (messageError) throw messageError;

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
        // First check unified conversations table for type and participants
        const { data: convRow, error: convError } = await supabase
          .from('conversations')
          .select('type, participant_ids')
          .eq('id', chatId)
          .single();

        let toUserId: string | null = null;
        
        if (convError && convError.code !== 'PGRST116') {
          // Log unexpected database errors (PGRST116 is 'not found', which is expected for legacy chats)
          console.error('Error fetching unified conversation for notification:', convError);
        }

        if (convRow) {
          // Use unified participant array
          const participants: string[] = convRow.participant_ids || [];
          const recipient = participants.find((id: string) => id !== senderId);
          if (recipient) {
            toUserId = recipient;
          }
        } else {
          // Fallback to legacy item_chats for marketplace chats or missing conversation rows
          const { data: chatRow } = await supabase
            .from('item_chats')
            .select('buyer_id, seller_id')
            .eq('id', chatId)
            .single();

          if (chatRow) {
            toUserId = chatRow.buyer_id === senderId ? chatRow.seller_id : chatRow.buyer_id;
          }
        }

        if (toUserId) {
          const { NotificationTriggers } = await import('@/lib/notification-triggers');
          await NotificationTriggers.onMessageSent(
            toUserId,
            senderId,
            chatId,
            imageUrl ? '📷 Photo' : content
          );
        }
      } catch (notifError) {
        console.error('Error firing message notification:', notifError);
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
          table: 'messages',
          filter: `conversation_id=eq.${chatId}`,
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

  static async markMessagesAsRead(chatId:string,userId:string): Promise<void> {
    const { data,error } = await supabase.from('messages').select('id,read_by')
      .eq('conversation_id',chatId).neq('sender_id',userId);
    if (error) throw error;
    for (const message of data || []) {
      if (message.read_by?.includes(userId)) continue;
      const { error:updateError } = await supabase.from('messages').update({ read_by:[...(message.read_by || []),userId] }).eq('id',message.id);
      if (updateError) throw updateError;
    }
  }
}
