"use client";

import type { ItemChat, ChatMessage } from "../../types/chat";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useTheme } from "next-themes";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { SendHorizonal, Search, ArrowLeft, ShoppingBag, ImagePlus, X } from "lucide-react";
import { Textarea } from "../ui/textarea";
import { SupabaseChatService } from "@/lib/supabase-chat-service";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Progress } from "../ui/progress";
import { OnlineStatusService } from "@/lib/online-status";
import { AvatarOnlineIndicator } from "../ui/online-indicator";
import { supabase } from "@/lib/supabase";
import { StorageService } from "@/lib/storage-service";
import type { User } from "@/types";

// Utility function to get chat wallpaper based on theme
const getChatWallpaper = (isDark: boolean) => {
  const baseUrl = process.env.NODE_ENV === 'production' 
    ? process.env.NEXT_PUBLIC_BASE_URL || '' 
    : '';
  
  return isDark 
    ? `${baseUrl}/chatwallpaper2.jpg` 
    : `${baseUrl}/chatwallpaper1.jpg`;
};

// Helper function to format date for display
const formatMessageDate = (timestamp: Date) => {
  if (!timestamp) return "";
  
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const messageDate = new Date(timestamp.getFullYear(), timestamp.getMonth(), timestamp.getDate());
  
  if (messageDate.getTime() === today.getTime()) {
    return "Today";
  } else if (messageDate.getTime() === yesterday.getTime()) {
    return "Yesterday";
  } else {
    return timestamp.toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  }
};

// Helper function to check if two timestamps are on different dates
const isDifferentDate = (timestamp1: Date, timestamp2: Date) => {
  if (!timestamp1 || !timestamp2) return false;
  
  return timestamp1.toDateString() !== timestamp2.toDateString();
};

interface MarketplaceChatLayoutProps {
  selectedChatId?: string;
}

export function MarketplaceChatLayout({
  selectedChatId,
}: MarketplaceChatLayoutProps) {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { theme } = useTheme();
  const [chats, setChats] = useState<ItemChat[]>([]);
  const [selectedChat, setSelectedChat] = useState<ItemChat | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [buyer, setBuyer] = useState<User | null>(null);
  const [buyers, setBuyers] = useState<{ [buyerId: string]: User }>({});
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const [showChat, setShowChat] = useState(false);
  const [onlineStatuses, setOnlineStatuses] = useState<{ [userId: string]: boolean }>({});

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    };
  }, []);

  // Initialize online status tracking for current user
  useEffect(() => {
    if (user?.id) {
      OnlineStatusService.getInstance().initialize(user.id);
      
      return () => {
        OnlineStatusService.getInstance().cleanup();
      };
    }
  }, [user?.id]);

  // Track online status of chat participants
  useEffect(() => {
    if (!user?.id) return;

    const participants = chats.map(chat => ({ uid: chat.buyerId }));
    const unsubscribeFunctions: (() => void)[] = [];

    participants.forEach(participant => {
      const unsubscribe = OnlineStatusService.getInstance().listenToUserOnlineStatus(participant.uid, (status) => {
        setOnlineStatuses(prev => ({
          ...prev,
          [participant.uid]: status.isOnline
        }));
      });
      unsubscribeFunctions.push(unsubscribe);
    });

    return () => {
      unsubscribeFunctions.forEach(unsubscribe => unsubscribe());
    };
  }, [user?.id, chats]);

  // Load marketplace chats (both as buyer and seller) and participant information
  useEffect(() => {
    if (!user?.id) return;

    const loadChats = async () => {
      try {
        // Load both buyer and seller chats
        const [buyerChats, sellerChats] = await Promise.all([
          SupabaseChatService.getUserChats(user.id),
          SupabaseChatService.getSellerChats(user.id)
        ]);
        
        // Combine and deduplicate chats
        const allChats = [...buyerChats, ...sellerChats];
        const uniqueChats = allChats.filter((chat, index, self) => 
          index === self.findIndex(c => c.id === chat.id)
        );
        
        setChats(uniqueChats);
        
        // Load participant information for all chats
        const participantIds = new Set<string>();
        uniqueChats.forEach(chat => {
          participantIds.add(chat.buyerId);
          participantIds.add(chat.sellerId);
        });
        
        const participantsData: { [userId: string]: User } = {};
        
        for (const userId of participantIds) {
          try {
            const { data: userData, error } = await supabase
              .from('users')
              .select('*')
              .eq('id', userId)
              .single();
            
            if (userData && !error) {
              participantsData[userId] = {
                id: userData.id,
                uid: userData.id,
                name: userData.name,
                avatar_url: userData.avatar_url || 'https://placehold.co/100x100.png',
                email: userData.email || '',
                bio: userData.bio || '',
                location: userData.location || { state: '', lga: '' },
                friends: userData.friends || [],
                blockedUsers: userData.blocked_users || [],
                notificationSettings: userData.notification_settings || {},
                isOnline: userData.is_online || false,
                lastSeen: userData.last_seen ? new Date(userData.last_seen) as any : null,
                timestamp: userData.created_at ? new Date(userData.created_at) as any : null,
              } as User;
            }
          } catch (error) {
            console.error(`Error loading user ${userId}:`, error);
          }
        }
        
        setBuyers(participantsData);
      } catch (error) {
        console.error("Error loading marketplace chats:", error);
      }
    };

    loadChats();
  }, [user?.id]);

  // Pre-select a chat if an ID is passed
  useEffect(() => {
    const chatToSelect = chats.find(c => c.id === selectedChatId);
    if (chatToSelect) {
      setSelectedChat(chatToSelect);
      setShowChat(true);
    } else {
      setSelectedChat(null);
      setShowChat(false);
    }
  }, [selectedChatId, chats]);

  // Mark messages as read when a chat is selected
  useEffect(() => {
    if (selectedChat?.id && user?.id) {
      SupabaseChatService.markMessagesAsRead(selectedChat.id, user.id)
        .catch(console.error);

      // We must ALSO update conversations for UI responsiveness
      const markConv = async () => {
        const { data: conv } = await supabase.from("conversations").select("context, last_message_timestamp").eq("id", selectedChat.id).single();
        if (conv) {
          const lastMsgDate = conv.last_message_timestamp ? new Date(conv.last_message_timestamp).getTime() : 0;
          const readReceiptStr = conv.context?.read_receipts?.[user.id];
          const readReceiptDate = readReceiptStr ? new Date(readReceiptStr).getTime() : 0;
          
          if (readReceiptDate >= lastMsgDate && lastMsgDate > 0) return;

          const newContext = {
            ...(conv.context || {}),
            read_receipts: {
              ...(conv.context?.read_receipts || {}),
              [user.id]: new Date().toISOString()
            }
          };
          await supabase.from("conversations").update({ context: newContext, updated_at: new Date().toISOString() }).eq("id", selectedChat.id);
        }
      };
      markConv();
    }
  }, [selectedChat?.id, user?.id]);

  const handleChatSelect = useCallback((chat: ItemChat) => {
    router.push(`/messages/marketplace/${chat.id}`);
  }, [router]);

  const handleBackToList = useCallback(() => {
    setSelectedChat(null);
    setShowChat(false);
  }, []);

  // Load other participant information when chat is selected
  useEffect(() => {
    if (!selectedChat || !user?.id) return;

    const loadOtherParticipant = async () => {
      try {
        // Determine the other participant (the one the current user is chatting with)
        const isCurrentUserBuyer = selectedChat.buyerId === user?.id;
        const otherParticipantId = isCurrentUserBuyer ? selectedChat.sellerId : selectedChat.buyerId;
        
        const { data: userData, error } = await supabase
          .from('users')
          .select('*')
          .eq('id', otherParticipantId)
          .single();
        
        if (userData && !error) {
          setBuyer({
            id: userData.id,
            uid: userData.id,
            name: userData.name,
            avatar_url: userData.avatar_url || 'https://placehold.co/100x100.png',
            email: userData.email || '',
            bio: userData.bio || '',
            location: userData.location || { state: '', lga: '' },
            friends: userData.friends || [],
            blockedUsers: userData.blocked_users || [],
            notificationSettings: userData.notification_settings || {},
            isOnline: userData.is_online || false,
            lastSeen: userData.last_seen ? new Date(userData.last_seen) as any : null,
            timestamp: userData.created_at ? new Date(userData.created_at) as any : null,
          } as User);
        }
      } catch (error) {
        console.error("Error loading other participant:", error);
      }
    };

    loadOtherParticipant();
  }, [selectedChat, user?.id]);

  // Listen for messages in the selected chat
  useEffect(() => {
    if (!selectedChat?.id || !user?.id) return;

    const unsubscribe = SupabaseChatService.subscribeToChat(selectedChat.id, (messages) => {
      setMessages(messages);
    });

    return () => unsubscribe();
  }, [selectedChat, user?.id]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
    }
  }, [messages]);

  const handleTyping = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setNewMessage(e.target.value);
  }, []);
  
  const handleSendMessage = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if ((newMessage.trim() === "" && !imageFile) || !selectedChat || !user) return;

    try {
      let imageUrl: string | undefined;
      
      // Upload image if one is selected
      if (imageFile) {
        const { url, error: uploadError } = await StorageService.uploadChatImage(user?.id!, imageFile);
        if (uploadError) {
          console.error('Image upload error:', uploadError);
          throw uploadError;
        }
        imageUrl = url || undefined;
      }

      await SupabaseChatService.sendMessage(
        selectedChat.id,
        user?.id!,
        profile?.name || user?.user_metadata?.name || 'Anonymous',
        newMessage.trim(),
        imageUrl
      );
      
      // Trigger notification for the other participant
      if (buyer?.uid) {
        try {
          const { NotificationTriggers } = await import("@/lib/notification-triggers");
          await NotificationTriggers.onMessageSent(
            buyer.uid,
            user.id,
            selectedChat.id,
            newMessage.trim() || (imageUrl ? "📷 Photo" : "")
          );
        } catch (error) {
          console.error("Error triggering notification:", error);
        }
      }
      
      setNewMessage("");
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
      setImageFile(null);
      setImagePreview(null);
      setUploadProgress(null);
    } catch (error) {
      console.error("Error sending message: ", error);
      setUploadProgress(null);
    }
  }, [newMessage, imageFile, selectedChat, user, profile?.name, buyer]);

  // Chat input is now inlined to prevent focus loss

  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
      const url = URL.createObjectURL(file);
      previewUrlRef.current = url;
      setImageFile(file);
      setImagePreview(url);
    }
  }, []);

  const removeImagePreview = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setImageFile(null);
    setImagePreview(null);
    if(fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const ChatList = useMemo(() => (
    <div className="h-full flex flex-col bg-[var(--yrdly-dark)] text-foreground font-yrdly-body">
      <div className="p-4 border-b border-[var(--yrdly-glass-border)]">
        <h2 className="text-xl font-yrdly-display font-bold mb-4">Marketplace Chats</h2>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-[var(--yrdly-label)]" />
          <Input placeholder="Search marketplace chats" className="pl-8 bg-[var(--yrdly-glass-bg)] border-[var(--yrdly-glass-border)] font-yrdly-body text-foreground placeholder:text-[var(--yrdly-label)]" />
        </div>
      </div>
      <ScrollArea className="flex-1">
        {chats.length > 0 ? (
          chats.map((chat) => {
            const isUnread = chat.lastMessage?.senderId !== user?.id && !chat.lastMessage?.isRead;

            // Determine the other participant (the one the current user is chatting with)
            const isCurrentUserBuyer = chat.buyerId === user?.id;
            const otherParticipantId = isCurrentUserBuyer ? chat.sellerId : chat.buyerId;
            const otherParticipant = buyers[otherParticipantId];
            const participantRole = isCurrentUserBuyer ? 'Seller' : 'Buyer';
            
            return (
              <div
                key={chat.id}
                className={cn(
                  "flex flex-col gap-2 p-4 cursor-pointer hover:bg-[var(--yrdly-glass-bg)] border-b border-[var(--yrdly-glass-border)]/50 last:border-0 transition-colors",
                  selectedChat?.id === chat.id && "bg-[var(--yrdly-glass-bg)]"
                )}
                onClick={() => handleChatSelect(chat)}
              >
                {/* Listing context pill — always visible */}
                <div className="flex items-center gap-2">
                  <div className="relative w-8 h-8 rounded-md overflow-hidden flex-shrink-0 border border-[var(--yrdly-glass-border)]">
                    <Image
                      src={chat.itemImageUrl || '/placeholder-item.jpg'}
                      alt={chat.itemTitle}
                      fill
                      className="object-cover"
                      sizes="32px"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-yrdly-body font-medium text-[var(--yrdly-label)] truncate">{chat.itemTitle}</p>
                    {chat.itemPrice ? (
                      <p className="text-xs font-yrdly-display font-bold text-primary">
                        {new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 0 }).format(chat.itemPrice)}
                      </p>
                    ) : (
                      <p className="text-xs font-yrdly-body text-[var(--yrdly-label)]/60">Free</p>
                    )}
                  </div>
                  {isUnread && <div className="h-2.5 w-2.5 rounded-full bg-primary flex-shrink-0" />}
                </div>

                {/* Participant + last message */}
                <div className="flex items-center gap-3">
                  <div className="relative flex-shrink-0">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={otherParticipant?.avatar_url} alt={otherParticipant?.name || participantRole} />
                      <AvatarFallback className="text-xs font-yrdly-display">
                        {otherParticipant?.name?.charAt(0) || participantRole.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <AvatarOnlineIndicator 
                      isOnline={onlineStatuses[otherParticipantId] || false} 
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-yrdly-display font-semibold leading-none mb-0.5">
                      {otherParticipant?.name || `Unknown ${participantRole}`}
                      <span className="text-xs font-yrdly-body font-normal text-[var(--yrdly-label)] ml-1.5">· {participantRole}</span>
                    </p>
                    <p className={cn("text-xs font-yrdly-body truncate", isUnread ? "text-foreground font-medium" : "text-[var(--yrdly-label)]")}>
                      {chat.lastMessage?.content || "No messages yet"}
                    </p>
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="p-4">
            <div className="flex flex-col items-center justify-center h-full text-[var(--yrdly-label)] p-4 text-center bg-[var(--yrdly-glass-bg)] border border-[var(--yrdly-glass-border)] rounded-2xl">
              <div className="mb-4 rounded-full bg-primary/10 p-4">
                <ShoppingBag className="h-10 w-10 text-primary" />
              </div>
              <h3 className="text-xl font-yrdly-display font-semibold text-foreground mb-1">
                No marketplace chats
              </h3>
              <p className="mb-4 max-w-sm font-yrdly-body text-sm text-[var(--yrdly-label)]">
                You don&apos;t have any marketplace chats yet. When buyers contact you about your items, they&apos;ll appear here.
              </p>
            </div>
          </div>
        )}
      </ScrollArea>
    </div>
  ), [chats, selectedChat, user?.id, handleChatSelect, buyers, onlineStatuses]);

  const ChatView = useMemo(() => {
    if (!selectedChat || !buyer) {
      return (
        <div className="hidden md:flex flex-1 items-center justify-center text-[var(--yrdly-label)] p-8 bg-[var(--yrdly-dark)] font-yrdly-body">
          <div className="flex flex-col items-center justify-center h-full text-[var(--yrdly-label)] p-4 text-center bg-[var(--yrdly-glass-bg)] border border-[var(--yrdly-glass-border)] rounded-2xl">
            <div className="mb-4 rounded-full bg-primary/10 p-4">
              <ShoppingBag className="h-10 w-10 text-primary" />
            </div>
            <h3 className="text-xl font-yrdly-display font-semibold text-foreground mb-1">
              Select a marketplace chat
            </h3>
            <p className="mb-4 max-w-sm font-yrdly-body text-sm text-[var(--yrdly-label)]">
              Choose one of your marketplace chats to see the messages.
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col h-full bg-[var(--yrdly-dark)] text-foreground font-yrdly-body">
        <div className="border-b border-[var(--yrdly-glass-border)] bg-[var(--yrdly-dark)]">
          <div className="flex items-center gap-4 p-3">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={handleBackToList}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-3">
              <div className="relative">
                <Avatar>
                  <AvatarImage src={buyer.avatar_url} alt={buyer.name} />
                  <AvatarFallback className="font-yrdly-display">{buyer.name.charAt(0)}</AvatarFallback>
                </Avatar>
                <AvatarOnlineIndicator 
                  isOnline={onlineStatuses[buyer.uid] || false} 
                />
              </div>
              <div>
                <p className="font-yrdly-display font-semibold">{buyer.name}</p>
                <p className="text-sm font-yrdly-body text-[var(--yrdly-label)]">
                  {selectedChat.buyerId === user?.id ? 'Seller' : 'Buyer'}
                </p>
              </div>
            </div>
          </div>
          <div className="px-3 pb-3">
            <div className="flex items-center gap-3 p-3 bg-[var(--yrdly-glass-bg)] rounded-xl border border-[var(--yrdly-glass-border)]">
              <div className="relative w-14 h-14 rounded-lg overflow-hidden flex-shrink-0">
                <Image 
                  src={selectedChat.itemImageUrl || '/placeholder-item.jpg'} 
                  alt={selectedChat.itemTitle}
                  fill
                  className="object-cover"
                  sizes="56px"
                />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-[var(--yrdly-label)] font-yrdly-body font-medium mb-0.5">About this listing</p>
                <p className="font-yrdly-display font-semibold text-foreground text-sm leading-tight truncate">{selectedChat.itemTitle}</p>
                {selectedChat.itemPrice ? (
                  <p className="text-sm font-yrdly-display font-bold text-primary mt-0.5">
                    {new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 0 }).format(selectedChat.itemPrice)}
                  </p>
                ) : (
                  <p className="text-xs font-yrdly-body text-[var(--yrdly-label)] mt-0.5">Free item</p>
                )}
              </div>
            </div>
          </div>
        </div>
        <ScrollArea 
          ref={scrollAreaRef} 
          className="flex-1 p-4 min-h-0 relative"
        >
          {/* Background wallpaper */}
          <div 
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage: `url(${getChatWallpaper(theme === 'dark')})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat',
              backgroundAttachment: 'fixed'
            }}
          />
          {/* Semi-transparent overlay for text readability */}
          <div className="absolute inset-0 bg-black/40 pointer-events-none" />
          <div className="space-y-4 relative z-10 font-yrdly-body">
            {messages.map((msg, index) => {
              const showDateSeparator = index === 0 || 
                (messages[index - 1] && 
                 isDifferentDate(
                   messages[index - 1].timestamp, 
                   msg.timestamp
                 ));
              
              return (
                <div key={msg.id}>
                  {showDateSeparator && (
                    <div className="flex justify-center my-4">
                      <div className="bg-[var(--yrdly-glass-bg)] border border-[var(--yrdly-glass-border)] text-[var(--yrdly-label)] px-3 py-1 rounded-full text-xs font-yrdly-body font-medium">
                        {formatMessageDate(msg.timestamp)}
                      </div>
                    </div>
                  )}
                  <div
                    className={cn("flex gap-3", msg.senderId === user?.id ? "justify-end" : "justify-start")}
                  >
                    {msg.senderId !== user?.id && (
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={buyer.avatar_url} />
                        <AvatarFallback className="font-yrdly-display">{buyer.name.charAt(0)}</AvatarFallback>
                      </Avatar>
                    )}
                    <div className={cn("rounded-2xl px-4 py-2.5 max-w-xs lg:max-w-md break-words text-sm font-yrdly-body shadow-sm", msg.senderId === user?.id ? "bg-primary text-primary-foreground" : "bg-[var(--yrdly-glass-bg)] border border-[var(--yrdly-glass-border)] text-foreground")}>
                      {msg.metadata?.imageUrl && (
                        <div className="relative w-48 h-48 mb-2">
                          <Image src={msg.metadata.imageUrl} alt="Chat image" layout="fill" className="rounded-md object-cover" />
                        </div>
                      )}
                      {msg.content && <p>{msg.content}</p>}
                      <p className={cn("text-[10px] opacity-70 mt-1 font-yrdly-body", msg.senderId === user?.id ? "text-right" : "text-left")}>
                        {msg.timestamp.toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
        <div className="p-4 border-t border-[var(--yrdly-glass-border)] bg-[var(--yrdly-dark)] font-yrdly-body">
          {imagePreview && (
            <div className="relative w-24 h-24 mb-2">
              <Image src={imagePreview} alt="Image preview" layout="fill" className="rounded-md object-cover" />
              <Button variant="destructive" size="icon" className="absolute -top-2 -right-2 h-6 w-6 rounded-full" onClick={removeImagePreview}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}
          {uploadProgress !== null && <Progress value={uploadProgress} className="mb-2" />}
          <form onSubmit={handleSendMessage} className="flex items-center gap-2">
            <input type="file" accept="image/*" ref={fileInputRef} onChange={handleImageSelect} className="hidden" />
            <Button type="button" variant="ghost" size="icon" onClick={() => fileInputRef.current?.click()} className="text-[var(--yrdly-label)] hover:text-foreground">
              <ImagePlus className="h-5 w-5" />
            </Button>
            <Textarea
              placeholder="Type a message..."
              value={newMessage}
              onChange={handleTyping}
              className="flex-1 resize-none bg-[var(--yrdly-glass-bg)] border-[var(--yrdly-glass-border)] font-yrdly-body text-foreground placeholder:text-[var(--yrdly-label)]"
              rows={1}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage(e);
                }
              }}
            />
            <Button type="submit" size="icon" disabled={(!newMessage.trim() && !imageFile) || uploadProgress !== null} className="bg-primary text-primary-foreground hover:bg-primary/90">
              <SendHorizonal className="h-5 w-5" />
            </Button>
          </form>
        </div>
      </div>
    );
  }, [selectedChat, buyer, handleBackToList, onlineStatuses, messages, user?.id, theme, imagePreview, uploadProgress, handleSendMessage, newMessage, imageFile, handleTyping, removeImagePreview, handleImageSelect, fileInputRef, scrollAreaRef]);

  return (
    <div className="h-full w-full flex bg-[var(--yrdly-dark)] text-foreground font-yrdly-body border-0 rounded-none">
      <div className={cn("w-full md:w-1/3 border-r border-[var(--yrdly-glass-border)]", { 'hidden md:flex': showChat })}>
        {ChatList}
      </div>
      <div className={cn("w-full md:w-2/3", { 'hidden md:flex': !showChat })}>
        {ChatView}
      </div>
    </div>
  );
}

