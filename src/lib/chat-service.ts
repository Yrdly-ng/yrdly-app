import { supabase } from '@/lib/supabase';
import { ChatMessage, ItemChat, ChatParticipant } from '@/types/chat';

export class ChatService {
  // Create or get existing chat for an item
  static async getOrCreateChat(
    itemId: string,
    buyerId: string,
    sellerId: string,
    itemTitle: string,
    itemImageUrl: string,
    itemPrice?: number
  ): Promise<string> {
    // Check if chat already exists
    const { data: existingChats, error: fetchError } = await supabase
      .from('item_chats')
      .select('id')
      .eq('item_id', itemId)
      .eq('buyer_id', buyerId)
      .eq('seller_id', sellerId)
      .limit(1);

    if (fetchError) throw fetchError;
    
    if (existingChats && existingChats.length > 0) {
      return existingChats[0].id;
    }

    // Create new chat
    const chatData: Record<string, unknown> = {
      item_id: itemId,
      buyer_id: buyerId,
      seller_id: sellerId,
      item_title: itemTitle,
      item_image_url: itemImageUrl,
      last_activity: new Date().toISOString(),
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (itemPrice !== undefined) {
      chatData.item_price = itemPrice;
    }

    const { data, error } = await supabase
      .from('item_chats')
      .insert(chatData)
      .select('id')
      .single();

    if (error) throw error;
    return data.id;
  }

  // Send a message
  static async sendMessage(
    chatId: string,
    senderId: string,
    senderName: string,
    content: string,
    messageType: ChatMessage['messageType'] = 'text',
    metadata?: ChatMessage['metadata']
  ): Promise<string> {
    const messageData = {
      chat_id: chatId,
      sender_id: senderId,
      sender_name: senderName,
      content,
      // Note: is_read is not stored in chat_messages table - it's computed/derived
      message_type: messageType,
      metadata: metadata || null,
      timestamp: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('chat_messages')
      .insert(messageData)
      .select('id')
      .single();

    if (error) throw error;

    // Update chat last activity
    const { error: updateError } = await supabase
      .from('item_chats')
      .update({
        last_activity: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', chatId);

    if (updateError) throw updateError;

    return data.id;
  }

  // Get chat messages
  static async getChatMessages(chatId: string): Promise<ChatMessage[]> {
    const { data, error } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('chat_id', chatId)
      .order('timestamp', { ascending: true });

    if (error) throw error;
    return data as ChatMessage[];
  }

  // Get user's chats
  static async getUserChats(userId: string): Promise<ItemChat[]> {
    const { data: chats, error: chatsError } = await supabase
      .from('item_chats')
      .select('*')
      .eq('buyer_id', userId)
      .order('last_activity', { ascending: false });

    if (chatsError) throw chatsError;

    const chatsWithMessages: ItemChat[] = [];

    for (const chat of chats) {
      // Get the last message for this chat
      const { data: lastMessage, error: messageError } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('chat_id', chat.id)
        .order('timestamp', { ascending: false })
        .limit(1)
        .single();

      if (messageError && messageError.code !== 'PGRST116') {
        console.error('Error fetching last message:', messageError);
      }

      chatsWithMessages.push({
        ...chat,
        itemPrice: chat.item_price ?? undefined,
        lastMessage: lastMessage || undefined
      } as ItemChat);
    }

    return chatsWithMessages;
  }

  // Get seller's chats
  static async getSellerChats(sellerId: string): Promise<ItemChat[]> {
    const { data: chats, error: chatsError } = await supabase
      .from('item_chats')
      .select('*')
      .eq('seller_id', sellerId)
      .order('last_activity', { ascending: false });

    if (chatsError) throw chatsError;

    const chatsWithMessages: ItemChat[] = [];

    for (const chat of chats) {
      // Get the last message for this chat
      const { data: lastMessage, error: messageError } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('chat_id', chat.id)
        .order('timestamp', { ascending: false })
        .limit(1)
        .single();

      if (messageError && messageError.code !== 'PGRST116') {
        console.error('Error fetching last message:', messageError);
      }

      chatsWithMessages.push({
        ...chat,
        itemPrice: chat.item_price ?? undefined,
        lastMessage: lastMessage || undefined
      } as ItemChat);
    }

    return chatsWithMessages;
  }

  // Mark messages as read
  static async markMessagesAsRead(chatId: string, userId: string): Promise<void> {
    const { error } = await supabase
      .from('chat_messages')
      .update({ is_read: true })
      .eq('chat_id', chatId)
      .neq('sender_id', userId)
      .eq('is_read', false);

    if (error) throw error;
  }

  // Listen to chat messages in real-time
  static subscribeToChat(
    chatId: string,
    callback: (messages: ChatMessage[]) => void
  ): () => void {
    const channel = supabase
      .channel(`chat_${chatId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'chat_messages',
        filter: `chat_id=eq.${chatId}`
      }, (payload) => {
        // Re-fetch messages on any change
        this.getChatMessages(chatId).then(callback).catch(console.error);
      })
      .subscribe();

    // Also fetch initial messages
    this.getChatMessages(chatId).then(callback).catch(console.error);

    return () => {
      supabase.removeChannel(channel);
    };
  }

  // Send an offer
  static async sendOffer(
    chatId: string,
    senderId: string,
    senderName: string,
    offerAmount: number
  ): Promise<string> {
    // Store offer as 'text' type with offer data in metadata (database constraint doesn't allow 'offer' type)
    return this.sendMessage(
      chatId,
      senderId,
      senderName,
      `Offering ₦${offerAmount.toLocaleString()} for this item`,
      'text',
      {
        offerAmount,
        offerStatus: 'pending'
      }
    );
  }

  // Respond to an offer
  static async respondToOffer(
    messageId: string,
    accepted: boolean
  ): Promise<void> {
    const { error } = await supabase
      .from('chat_messages')
      .update({
        metadata: {
          offerStatus: accepted ? 'accepted' : 'rejected'
        }
      })
      .eq('id', messageId);

    if (error) throw error;
  }
}
