export interface ChatMessage {
  id: string;
  chatId: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: Date;
  // Note: isRead is computed/derived - not stored in chat_messages table
  isRead: boolean;
  // Database constraint allows: 'text' | 'image' | 'system'
  // 'offer' type should be stored as 'text' with offer data in metadata
  messageType: 'text' | 'image' | 'system';
  metadata?: {
    offerAmount?: number;
    offerStatus?: 'pending' | 'accepted' | 'rejected';
    imageUrl?: string;
  };
}

export interface ItemChat {
  id: string;
  itemId: string;
  buyerId: string;
  sellerId: string;
  itemTitle: string;
  itemImageUrl: string;
  itemPrice?: number;
  lastMessage?: ChatMessage;
  lastActivity: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatParticipant {
  id: string;
  name: string;
  avatar_url?: string;
  isOnline: boolean;
  lastSeen?: Date;
}
