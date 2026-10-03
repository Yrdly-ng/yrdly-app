"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ArrowLeft, Send, Smile, MoreVertical } from "lucide-react";
import type { Business, CatalogItem, BusinessMessage } from "@/types";
import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/use-supabase-auth";
import { supabase } from "@/lib/supabase";
import Image from "next/image";

interface BusinessChatScreenProps {
  business: Business;
  item?: CatalogItem;
  conversationId?: string;
  onBack: () => void;
}

export function BusinessChatScreen({ business, item, conversationId: initialConvId, onBack }: BusinessChatScreenProps) {
  const { user, profile } = useAuth();
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<BusinessMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [convId, setConvId] = useState<string | undefined>(initialConvId);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Obtain conversationId if not passed in props
  useEffect(() => {
    if (convId || !user || !business) return;
    const findConv = async () => {
      const { data } = await supabase
        .from('conversations')
        .select('id')
        .contains('participant_ids', [user.id])
        .eq('type', 'business')
        .eq('business_id', business.id)
        .maybeSingle();
      if (data?.id) {
        setConvId(data.id);
      }
    };
    findConv();
  }, [user, business, convId]);

  useEffect(() => {
    if (!user || !business) return;

    const fetchMessages = async () => {
      try {
        let mainMsgs: any[] = [];
        const activeConvId = convId || initialConvId;
        if (activeConvId) {
          const { data: dbMsgs } = await supabase
            .from('messages')
            .select('*')
            .eq('conversation_id', activeConvId)
            .order('created_at', { ascending: true });
          if (dbMsgs) mainMsgs = dbMsgs;
        }

        const { data: bizMsgs } = await supabase
          .from('business_messages')
          .select(`
            *,
            users!business_messages_sender_id_fkey(
              name,
              avatar_url
            )
          `)
          .eq('business_id', business.id)
          .order('created_at', { ascending: true });

        // Filter bizMsgs by item_id if provided
        let filteredBizData = bizMsgs || [];
        if (item?.id) {
          filteredBizData = filteredBizData.filter(msg => msg.item_id === item.id);
        } else {
          filteredBizData = filteredBizData.filter(msg => !msg.item_id);
        }

        // Fetch user data for senders in mainMsgs
        const mainSenderIds = Array.from(new Set(mainMsgs.map(m => m.sender_id))).filter(Boolean);
        let usersMap = new Map();
        if (mainSenderIds.length > 0) {
          const { data: usersData } = await supabase
            .from('users')
            .select('id, name, avatar_url')
            .in('id', mainSenderIds);
          if (usersData) {
            usersMap = new Map(usersData.map(u => [u.id, u]));
          }
        }

        const formattedMain: BusinessMessage[] = mainMsgs.map(m => {
          const sender = usersMap.get(m.sender_id);
          return {
            id: m.id,
            business_id: business.id,
            sender_id: m.sender_id,
            sender_name: sender?.name || (m.sender_id === user.id ? (profile?.name || "You") : "User"),
            sender_avatar: sender?.avatar_url || (m.sender_id === user.id ? profile?.avatar_url : undefined),
            content: m.text || m.content || "",
            timestamp: new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            is_read: m.is_read || false,
            created_at: m.created_at
          };
        });

        const formattedBiz: BusinessMessage[] = filteredBizData.map(msg => ({
          id: msg.id,
          business_id: msg.business_id,
          sender_id: msg.sender_id,
          sender_name: msg.users?.name || (msg.sender_id === user.id ? (profile?.name || "You") : "User"),
          sender_avatar: msg.users?.avatar_url || (msg.sender_id === user.id ? profile?.avatar_url : undefined),
          content: msg.content,
          timestamp: new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          is_read: msg.is_read,
          item_id: msg.item_id,
          created_at: msg.created_at
        }));

        // Merge both message arrays and deduplicate by content + timestamp proximity
        const map = new Map<string, BusinessMessage>();
        [...formattedBiz, ...formattedMain].forEach(msg => {
          const createdTime = msg.created_at ? new Date(msg.created_at).getTime() : Date.now();
          const key = `${msg.sender_id}_${msg.content.trim()}_${createdTime}`;
          if (!map.has(key)) {
            map.set(key, msg);
          }
        });

        const merged = Array.from(map.values()).sort(
          (a, b) => (a.created_at ? new Date(a.created_at).getTime() : 0) - (b.created_at ? new Date(b.created_at).getTime() : 0)
        );

        setMessages(merged);
      } catch (error) {
        console.error("Error fetching messages:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchMessages();

    const activeConvId = convId || initialConvId;
    const channels: any[] = [];

    if (activeConvId) {
      const msgChannel = supabase
        .channel(`messages_channel_${activeConvId}`)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${activeConvId}`
        }, async (payload) => {
          const newM = payload.new as any;
          if (user && newM.sender_id === user.id) return;

          const { data: uData } = await supabase.from('users').select('name, avatar_url').eq('id', newM.sender_id).maybeSingle();
          const transformed: BusinessMessage = {
            id: newM.id,
            business_id: business.id,
            sender_id: newM.sender_id,
            sender_name: uData?.name || "User",
            sender_avatar: uData?.avatar_url,
            content: newM.text || newM.content || "",
            timestamp: new Date(newM.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            is_read: newM.is_read || false,
            created_at: newM.created_at
          };
          setMessages(prev => {
            if (prev.some(m => m.id === transformed.id || (m.sender_id === transformed.sender_id && m.content === transformed.content))) return prev;
            return [...prev, transformed];
          });
        })
        .subscribe();
      channels.push(msgChannel);
    }

    const bizChannel = supabase
      .channel(`biz_messages_${business.id}_${item?.id || 'gen'}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'business_messages',
        filter: `business_id=eq.${business.id}`
      }, async (payload) => {
        const newMessage = payload.new as any;
        if (user && newMessage.sender_id === user.id) return;
        if (item?.id && newMessage.item_id !== item.id) return;
        if (!item?.id && newMessage.item_id) return;

        const { data: userData } = await supabase.from('users').select('name, avatar_url').eq('id', newMessage.sender_id).maybeSingle();
        const transformed: BusinessMessage = {
          id: newMessage.id,
          business_id: newMessage.business_id,
          sender_id: newMessage.sender_id,
          sender_name: userData?.name || "User",
          sender_avatar: userData?.avatar_url,
          content: newMessage.content,
          timestamp: new Date(newMessage.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          is_read: newMessage.is_read,
          item_id: newMessage.item_id,
          created_at: newMessage.created_at
        };
        setMessages(prev => {
          if (prev.some(m => m.id === transformed.id || (m.sender_id === transformed.sender_id && m.content === transformed.content))) return prev;
          return [...prev, transformed];
        });
      })
      .subscribe();
    channels.push(bizChannel);

    return () => {
      channels.forEach(ch => supabase.removeChannel(ch));
    };
  }, [user, business, item, convId, initialConvId, profile]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleSend = async () => {
    if (!message.trim() || !user || !business) return;

    const messageContent = message.trim();
    const tempId = `temp-${Date.now()}`;
    const activeConvId = convId || initialConvId;
    
    const optimisticMessage: BusinessMessage = {
      id: tempId,
      business_id: business.id,
      sender_id: user.id,
      sender_name: profile?.name || user.user_metadata?.name || "You",
      sender_avatar: profile?.avatar_url || user.user_metadata?.avatar_url,
      content: messageContent,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      is_read: true,
      item_id: item?.id,
      created_at: new Date().toISOString()
    };

    setMessages(prev => [...prev, optimisticMessage]);
    setMessage("");

    try {
      // 1. Insert into main messages table if conversationId exists
      if (activeConvId) {
        await supabase
          .from('messages')
          .insert({
            conversation_id: activeConvId,
            sender_id: user.id,
            text: messageContent,
            content: messageContent,
            is_read: true,
            read_by: [user.id],
            created_at: new Date().toISOString()
          });
      }

      // 2. Insert into business_messages table for fallback/backwards compatibility
      const { data: insertedMessage, error } = await supabase
        .from('business_messages')
        .insert({
          business_id: business.id,
          sender_id: user.id,
          content: messageContent,
          item_id: item?.id || null,
          is_read: true
        })
        .select()
        .single();

      if (error && !activeConvId) {
        setMessages(prev => prev.filter(msg => msg.id !== tempId));
        throw error;
      }

      if (insertedMessage) {
        const { data: userData } = await supabase
          .from('users')
          .select('name, avatar_url')
          .eq('id', user.id)
          .single();

        const realMessage: BusinessMessage = {
          id: insertedMessage.id,
          business_id: insertedMessage.business_id,
          sender_id: insertedMessage.sender_id,
          sender_name: userData?.name || profile?.name || "You",
          sender_avatar: userData?.avatar_url || profile?.avatar_url,
          content: insertedMessage.content,
          timestamp: new Date(insertedMessage.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          is_read: insertedMessage.is_read,
          item_id: insertedMessage.item_id,
          created_at: insertedMessage.created_at
        };

        setMessages(prev => 
          prev.map(msg => msg.id === tempId ? realMessage : msg)
        );
      }

      // 3. Update conversation's last message
      if (activeConvId) {
        await supabase
          .from('conversations')
          .update({
            last_message_text: messageContent,
            last_message_timestamp: new Date().toISOString(),
            last_message_sender_id: user.id,
            updated_at: new Date().toISOString()
          })
          .eq('id', activeConvId);
      } else {
        await supabase
          .from('conversations')
          .update({
            last_message_text: messageContent,
            last_message_timestamp: new Date().toISOString(),
            last_message_sender_id: user.id,
            updated_at: new Date().toISOString()
          })
          .eq('business_id', business.id)
          .contains('participant_ids', [user.id]);
      }
    } catch (error) {
      setMessages(prev => prev.filter(msg => msg.id !== tempId));
      console.error('Error sending message:', error);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[100dvh]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading messages...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[100dvh] bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-border bg-card flex-shrink-0">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0">
          <Image 
            src={business.logo || business.owner_avatar || "/placeholder.svg"} 
            alt={business.name} 
            width={40}
            height={40}
            className="w-full h-full object-cover" 
          />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-foreground truncate">{business.name}</h2>
          <p className="text-sm text-muted-foreground truncate">{business.category}</p>
        </div>
        <Button variant="ghost" size="icon">
          <MoreVertical className="w-5 h-5" />
        </Button>
      </div>

      {/* Item context (if discussing a specific item) */}
      {item && (
        <div className="p-4 border-b border-border bg-muted/30 flex-shrink-0">
          <p className="text-xs text-muted-foreground mb-2">Discussing this item:</p>
          <Card className="p-3">
            <div className="flex gap-3">
              <div className="w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 bg-muted">
                <Image
                  src={item.images[0] || "/placeholder.svg"}
                  alt={item.title}
                  width={64}
                  height={64}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="font-semibold text-sm text-foreground truncate">{item.title}</h4>
                <p className="text-lg font-bold text-primary">₦{item.price.toLocaleString()}</p>
                {!item.in_stock && <p className="text-xs text-destructive">Out of stock</p>}
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
        {messages.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-muted-foreground">
              {item ? `Start a conversation about ${item.title}` : `Start a conversation with ${business.name}`}
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isOwn = msg.sender_id === user?.id;
            return (
              <div key={msg.id} className={`flex gap-2 ${isOwn ? "flex-row-reverse" : ""}`}>
                <Avatar className="w-8 h-8 flex-shrink-0">
                  <AvatarImage src={msg.sender_avatar || "/placeholder.svg"} />
                  <AvatarFallback>{msg.sender_name[0]}</AvatarFallback>
                </Avatar>
                <div className={`flex flex-col gap-1 max-w-[75%] ${isOwn ? "items-end" : ""}`}>
                  <div
                    className={`rounded-2xl px-4 py-2 ${
                      isOwn ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                    }`}
                  >
                    <p className="text-sm">{msg.content}</p>
                  </div>
                  <span className="text-xs text-muted-foreground px-2">{msg.timestamp}</span>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area - Fixed at bottom */}
      <div className="border-t border-border p-4 bg-card flex-shrink-0">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="flex-shrink-0">
            <Smile className="w-5 h-5" />
          </Button>
          <Input
            placeholder={item ? `Ask about ${item.title}...` : `Message ${business.name}...`}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyPress}
            className="flex-1 bg-background border-border"
          />
          <Button
            size="icon"
            className="flex-shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={handleSend}
            disabled={!message.trim()}
          >
            <Send className="w-5 h-5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
