"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/hooks/use-supabase-auth";
import { supabase } from "@/lib/supabase";
import { StorageService } from "@/lib/storage-service";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ArrowLeft, ImagePlus, VideoIcon, Send, MessageCircle, Loader2, Download, X, MoreVertical, Trash2, Edit, Copy } from "lucide-react";
import { useRouter } from "next/navigation";
import { ActivityIndicator } from "@/components/ActivityIndicator";
import { useTypingDetection } from "@/hooks/use-typing-detection";
import type { User } from "@/types";
import Image from "next/image";
import { useToast } from "@/hooks/use-toast";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

import { GlassCard } from "@/components/ui/glass-card";
import { cn } from "@/lib/utils";

interface ConversationRow {
  id: string;
  participant_ids: string[];
  last_message_text: string | null;
  last_message_timestamp: string | null;
  last_message_sender_id: string | null;
  created_at: string;
  updated_at: string;
  context?: any;
  type?: 'friend' | 'marketplace' | 'briefcase';
  item_id?: string;
  item_title?: string;
  item_image?: string;
  item_price?: number;
  business_name?: string;
}

interface ChatMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  text: string;
  content?: string;
  image_url: string | null;
  video_url?: string | null;
  media_url?: string | null;
  media_type?: string | null;
  created_at: string;
  is_read: boolean;
  read_by?: string[];
}

interface ConversationScreenProps {
  conversationId: string;
  onBack?: () => void;
  isEmbedded?: boolean;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function getActivityStatus(lastSeen: string | null | undefined): string {
  if (!lastSeen) return "Last seen recently";
  const diff = Math.floor((Date.now() - new Date(lastSeen).getTime()) / 60000);
  if (diff < 1) return "Active now";
  if (diff < 5) return "Last seen just now";
  if (diff < 60) return `Last seen ${diff} min ago`;
  const h = Math.floor(diff / 60);
  if (h < 24) return `Last seen ${h}h ago`;
  return `Last seen ${Math.floor(h / 24)}d ago`;
}

export function ConversationScreen({ conversationId, onBack, isEmbedded = false }: ConversationScreenProps) {
  const { user } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const handleDeleteMessageForMe = async (msgId: string) => {
    if (!user) return;
    try {
      const target = messages.find((m) => m.id === msgId);
      if (!target) return;
      const newDeletedBy = Array.from(new Set([...((target as any).deleted_by || []), user.id]));
      await supabase.from("messages").update({ deleted_by: newDeletedBy }).eq("id", msgId);
      setMessages((prev) => prev.filter((m) => m.id !== msgId));
      toast({ title: "Message deleted for you" });
    } catch (e) {
      toast({ title: "Error deleting message", variant: "destructive" });
    }
  };

  const handleDeleteMessageForEveryone = async (msgId: string) => {
    if (!user) return;
    try {
      await supabase.from("messages").delete().eq("id", msgId);
      setMessages((prev) => prev.filter((m) => m.id !== msgId));
      toast({ title: "Message deleted for everyone" });
    } catch (e) {
      toast({ title: "Error deleting message", variant: "destructive" });
    }
  };

  const handleEditMessage = async (msgId: string, newText: string) => {
    if (!user || !newText.trim()) return;
    try {
      const { error } = await supabase.from("messages").update({ text: newText.trim(), content: newText.trim() }).eq("id", msgId);
      if (error) throw error;
      setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, text: newText.trim(), content: newText.trim() } : m));
      toast({ title: "Message edited" });
    } catch (e) {
      toast({ title: "Error editing message", variant: "destructive" });
    }
  };

  const handleDeleteConversation = async () => {
    if (!user || !conversation) return;
    try {
      const { data: currentData } = await supabase.from("conversations").select("deleted_by").eq("id", conversation.id).single();
      const newDeletedBy = Array.from(new Set([...(currentData?.deleted_by || []), user.id]));
      await supabase.from("conversations").update({ deleted_by: newDeletedBy }).eq("id", conversation.id);
      toast({ title: "Conversation deleted" });
      router.push("/messages");
    } catch (e) {
      toast({ title: "Error deleting conversation", variant: "destructive" });
    }
  };

  const [conversation, setConversation] = useState<ConversationRow | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [participants, setParticipants] = useState<Record<string, User>>({});
  const [newMessage, setNewMessage] = useState("");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const { otherTypingUsers, handleTyping, stopTyping } = useTypingDetection(conversationId);

  // Dynamic Visual Viewport tracking for mobile virtual keyboard height
  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;

    const handleViewportResize = () => {
      if (window.visualViewport) {
        setViewportHeight(window.visualViewport.height);
      }
    };

    window.visualViewport.addEventListener("resize", handleViewportResize);
    window.visualViewport.addEventListener("scroll", handleViewportResize);
    handleViewportResize();

    return () => {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener("resize", handleViewportResize);
        window.visualViewport.removeEventListener("scroll", handleViewportResize);
      }
    };
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  /* ── Load conversation ── */
  useEffect(() => {
    if (!user) return;
    const fetch = async () => {
      const { data } = await supabase
        .from("conversations").select("*")
        .contains("participant_ids", [user.id])
        .order("updated_at", { ascending: false });
      const conv = data?.find((c) => c.id === conversationId) || null;
      setConversation(conv);
    };
    fetch();
  }, [user, conversationId]);

  /* ── Load participants ── */
  useEffect(() => {
    if (!conversation) return;
    const fetch = async () => {
      const { data } = await supabase
        .from("users").select("id, name, email, avatar_url, created_at, last_seen, is_online")
        .in("id", conversation.participant_ids);
      const map: Record<string, User> = {};
      data?.forEach((p) => {
        map[p.id] = { ...p, uid: p.id, timestamp: p.created_at };
      });
      setParticipants(map);
    };
    fetch();
  }, [conversation]);

  /* ── Load messages ── */
  useEffect(() => {
    if (!conversation) return;
    const fetch = async () => {
      const { data } = await supabase
        .from("messages").select("*")
        .eq("conversation_id", conversation.id)
        .order("created_at", { ascending: true });
      const visible = (data || []).filter((m: any) => !m.deleted_by?.includes(user?.id || ''));
      setMessages(visible);
      setLoading(false);
    };
    fetch();
  }, [conversation]);

  /* ── Mark as read ── */
  useEffect(() => {
    if (!conversation || !user) return;
    const mark = async () => {
      const { data: unread } = await supabase
        .from("messages").select("id, read_by")
        .eq("conversation_id", conversation.id)
        .neq("sender_id", user.id);
      
      const toUpdate = (unread || []).filter(msg => !msg.read_by?.includes(user.id));
      if (toUpdate.length > 0) {
        await supabase.rpc('mark_messages_as_read', {
          p_conversation_id: conversation.id,
          p_user_id: user.id
        });
      }

      // Clear notifications for this chat when opened
      await supabase.from("notifications").delete()
        .eq("user_id", user.id)
        .eq("type", "message")
        .eq("related_id", conversation.id);

      const lastMsgDate = conversation.last_message_timestamp ? new Date(conversation.last_message_timestamp).getTime() : 0;
      const readReceiptStr = conversation.context?.read_receipts?.[user.id];
      const readReceiptDate = readReceiptStr ? new Date(readReceiptStr).getTime() : 0;
      
      if (readReceiptDate >= lastMsgDate && toUpdate.length === 0) {
        return;
      }
      
      const newContext = {
        ...(conversation.context || {}),
        read_receipts: {
          ...(conversation.context?.read_receipts || {}),
          [user.id]: new Date().toISOString()
        }
      };

      await supabase.from("conversations")
        .update({ context: newContext, updated_at: new Date().toISOString() })
        .eq("id", conversation.id);
    };
    mark();
  }, [conversation, user]);

  /* ── Real-time messages ── */
  useEffect(() => {
    if (!conversation || !user) return;
    const ch = supabase.channel(`messages-${conversation.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `conversation_id=eq.${conversation.id}` },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setMessages((p) => [...p, payload.new as ChatMessage]);
            // Clear notification if a new message arrives while we are in the chat
            if (payload.new.sender_id !== user.id) {
              supabase.from("notifications").delete()
                .eq("user_id", user.id)
                .eq("type", "message")
                .eq("related_id", conversation.id).then();
            }
          }
          else if (payload.eventType === "UPDATE") setMessages((p) => p.map((m) => m.id === payload.new.id ? payload.new as ChatMessage : m));
          else if (payload.eventType === "DELETE") setMessages((p) => p.filter((m) => m.id !== payload.old.id));
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [conversation, user]);

  /* ── Activity ── */
  useEffect(() => {
    if (!user) return;
    const update = async () => {
      await supabase.from("users").update({ last_seen: new Date().toISOString(), is_online: true }).eq("id", user.id);
    };
    update();
    const interval = setInterval(update, 30000);
    const onVisible = () => { if (!document.hidden) update(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(interval); document.removeEventListener("visibilitychange", onVisible); };
  }, [user]);

  const otherParticipant = conversation
    ? participants[conversation.participant_ids.find((id) => id !== user?.id) || ""]
    : null;

  const handleSend = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !conversation || (!newMessage.trim() && !selectedFile && !videoFile)) return;
    setSending(true);
    try {
      let imageUrl: string | null = null;
      let videoUrl: string | null = null;
      if (selectedFile) {
        const { url, error } = await StorageService.uploadChatImage(conversation.id, selectedFile);
        if (!error) imageUrl = url;
      }
      if (videoFile) {
        const { url, error } = await StorageService.uploadChatVideo(conversation.id, videoFile);
        if (error) {
          const msg = typeof error === 'string' ? error : 'Video upload failed.';
          alert(msg);
          setSending(false);
          return;
        }
        videoUrl = url;
      }
      await supabase.from("messages").insert({
        conversation_id: conversation.id, sender_id: user.id,
        text: newMessage.trim() || "", image_url: imageUrl, video_url: videoUrl,
        media_url: imageUrl || videoUrl,
        media_type: videoUrl ? 'video' : (imageUrl ? 'image' : null),
        created_at: new Date().toISOString(), is_read: true, read_by: [user.id],
      });
      await supabase.from("conversations").update({
        updated_at: new Date().toISOString(),
        last_message_text: newMessage.trim() || (videoUrl ? "🎬 Video" : imageUrl ? "📷 Photo" : ""),
        last_message_timestamp: new Date().toISOString(),
        last_message_sender_id: user.id,
        deleted_by: [],
      }).eq("id", conversation.id);

      const others = conversation.participant_ids.filter((id) => id !== user.id);
      for (const pid of others) {
        try {
          const { NotificationTriggers } = await import("@/lib/notification-triggers");
          await NotificationTriggers.onMessageSent(pid, user.id, conversation.id, newMessage.trim() || (videoUrl ? "🎬 Video" : imageUrl ? "📷 Photo" : ""));
        } catch {}
      }
      setNewMessage(""); setSelectedFile(null); setImagePreview(null);
      clearVideoPreview();
      stopTyping();
    } catch (e) { console.error(e); } finally { setSending(false); }
  }, [user, conversation, newMessage, selectedFile, videoFile, stopTyping]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) return;
    setSelectedFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const videoPreviewUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (videoPreviewUrlRef.current) {
        URL.revokeObjectURL(videoPreviewUrlRef.current);
      }
    };
  }, []);

  const clearVideoPreview = () => {
    if (videoPreviewUrlRef.current) {
      URL.revokeObjectURL(videoPreviewUrlRef.current);
      videoPreviewUrlRef.current = null;
    }
    setVideoFile(null);
    setVideoPreview(null);
  };

  const handleVideoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const MAX = 15 * 1024 * 1024;
    const ALLOWED = ['video/mp4', 'video/webm', 'video/quicktime'];
    if (!ALLOWED.includes(file.type) || file.size > MAX) return;
    if (videoPreviewUrlRef.current) {
      URL.revokeObjectURL(videoPreviewUrlRef.current);
    }
    const url = URL.createObjectURL(file);
    videoPreviewUrlRef.current = url;
    setVideoFile(file);
    setVideoPreview(url);
    if (videoInputRef.current) videoInputRef.current.value = '';
  };

  const handleDownload = async (url: string, defaultFilename: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = defaultFilename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (e) {
      window.open(url, '_blank');
    }
  };

  /* ─── Render ─── */
  if (loading) {
    return (
      <div className="flex flex-col h-full bg-[var(--yrdly-dark)] text-foreground font-yrdly-body">
        <div className="h-16 animate-pulse bg-[var(--yrdly-glass-bg)] border-b border-[var(--yrdly-glass-border)]" />
        <div className="flex-1 flex flex-col gap-4 p-4 mt-6">
          <div className="w-[70%] h-16 bg-muted/20 animate-pulse rounded-[20px] rounded-tl-sm self-start" />
          <div className="w-[60%] h-12 bg-muted/20 animate-pulse rounded-[20px] rounded-tr-sm self-end" />
          <div className="w-[85%] h-20 bg-muted/20 animate-pulse rounded-[20px] rounded-tl-sm self-start" />
        </div>
      </div>
    );
  }

  if (!conversation || !otherParticipant) {
    return (
      <div className="flex flex-col h-full items-center justify-center bg-[var(--yrdly-dark)] text-foreground font-yrdly-body">
        <MessageCircle className="w-12 h-12 mb-4 text-primary opacity-40" />
        <p className="text-foreground mb-4 font-yrdly-body">Conversation not found</p>
        <button onClick={() => router.push("/messages")} className="rounded-full px-6 py-2 text-primary-foreground text-sm bg-primary font-yrdly-body">
          Back to Messages
        </button>
      </div>
    );
  }

  const activityStatus = getActivityStatus((otherParticipant as any).last_seen);

  return (
    <div
      style={viewportHeight && typeof window !== "undefined" && window.innerWidth < 768 ? { height: `${viewportHeight}px` } : undefined}
      className="w-full h-full flex-1 flex flex-col min-h-0 bg-[var(--yrdly-dark)] text-foreground font-yrdly-body relative"
    >
      {/* ── Top Bar ── */}
      <header className="sticky top-0 z-30 flex items-center justify-between px-4 py-3 bg-[var(--yrdly-dark)]/90 backdrop-blur-md border-b border-[var(--yrdly-glass-border)]">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => (onBack ? onBack() : router.push("/messages"))}
            className={cn(
              "w-9 h-9 rounded-xl flex items-center justify-center border border-[var(--yrdly-glass-border)] bg-[var(--yrdly-glass-bg)] transition-colors hover:bg-white/5",
              isEmbedded && "md:hidden"
            )}
          >
            <ArrowLeft className="w-4 h-4 text-foreground" />
          </button>
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <Avatar className="w-9 h-9 border border-[var(--yrdly-glass-border)]">
                <AvatarImage src={otherParticipant.avatar_url} />
                <AvatarFallback className="bg-primary text-foreground font-bold font-yrdly-display text-xs">
                  {otherParticipant.name?.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="absolute -bottom-0.5 -right-0.5">
                <ActivityIndicator userId={otherParticipant.id} size="sm" />
              </div>
            </div>
            <div>
              <h2 className="text-sm font-bold text-foreground font-yrdly-display truncate max-w-[140px]">
                {otherParticipant.name}
              </h2>
              <p className="text-[0.65rem] text-[var(--yrdly-label)] font-yrdly-body">
                {activityStatus}
              </p>
            </div>
          </div>
        </div>

        <div className="relative">
          <button
            className="w-9 h-9 rounded-xl flex items-center justify-center border border-[var(--yrdly-glass-border)] bg-[var(--yrdly-glass-bg)] transition-colors hover:bg-white/5"
            onClick={(e) => {
              const menu = e.currentTarget.nextElementSibling as HTMLElement;
              if (menu) menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
            }}
          >
            <MoreVertical className="w-4 h-4 text-[var(--yrdly-label)]" />
          </button>

          <GlassCard className="options-menu hidden absolute right-0 top-11 w-48 py-1.5 z-40 rounded-xl p-0 shadow-xl border border-[var(--yrdly-glass-border)]">
            <button
              className="w-full text-left px-4 py-2.5 text-xs text-[var(--yrdly-label)] hover:text-foreground hover:bg-white/5 transition-colors font-yrdly-body"
              onClick={async () => {
                if (confirm('Report this user?')) {
                  alert('User reported successfully.');
                }
              }}
            >
              Report User
            </button>
            <button
              className="w-full text-left px-4 py-2.5 text-xs text-red-500 hover:bg-red-500/10 transition-colors flex items-center gap-2 font-yrdly-body"
              onClick={handleDeleteConversation}
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete Conversation
            </button>
            <button
              className="w-full text-left px-4 py-2.5 text-xs text-red-500 hover:bg-red-500/10 transition-colors font-yrdly-body"
              onClick={async () => {
                if (confirm('Block this user?')) {
                  try {
                    const { data: profile } = await supabase.from('users').select('blocked_users').eq('id', user!.id).single();
                    if (profile) {
                      const blocked = profile.blocked_users || [];
                      if (!blocked.includes(otherParticipant.id)) {
                        await supabase.from('users').update({ blocked_users: [...blocked, otherParticipant.id] }).eq('id', user!.id);
                      }
                      alert('User blocked successfully.');
                      router.push('/messages');
                    }
                  } catch (e) {
                    alert('Error blocking user.');
                  }
                }
              }}
            >
              Block User
            </button>
          </GlassCard>
        </div>
      </header>

      {/* ── Item Context Banner ── */}
      {conversation.item_title && (
        <div className="px-4 pt-3">
          <GlassCard
            onClick={() => {
              if (conversation.item_id) {
                router.push(`/marketplace/${conversation.item_id}`);
              }
            }}
            className="flex items-center gap-3 p-3 rounded-2xl cursor-pointer hover:scale-[1.01] transition-all"
          >
            {conversation.item_image && (
              <div className="relative w-12 h-12 rounded-xl overflow-hidden shrink-0 border border-[var(--yrdly-glass-border)]">
                <Image
                  src={conversation.item_image}
                  alt={conversation.item_title || "Item"}
                  fill
                  className="object-cover"
                />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h3 className="text-xs font-bold text-foreground truncate font-yrdly-display">
                {conversation.item_title}
              </h3>
              {typeof conversation.item_price === 'number' && (
                <p className="text-xs font-bold mt-0.5 text-primary font-yrdly-display">
                  {conversation.item_price === 0 ? 'FREE' : `₦${conversation.item_price.toLocaleString()}`}
                </p>
              )}
            </div>
          </GlassCard>
        </div>
      )}

      {/* ── Messages List ── */}
      <main className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 ? (
          <GlassCard className="flex flex-col items-center justify-center py-16 text-center rounded-3xl my-8">
            <MessageCircle className="w-10 h-10 mb-2 text-primary opacity-50" />
            <p className="text-foreground text-sm font-bold font-yrdly-display">No messages yet</p>
            <p className="text-xs text-[var(--yrdly-label)] mt-1 font-yrdly-body">
              Say hello to {otherParticipant.name?.split(" ")[0]} 👋
            </p>
          </GlassCard>
        ) : (
          messages.map((msg, index) => {
            const isOwn = msg.sender_id === user?.id;
            const sender = participants[msg.sender_id];
            
            const currentMsgDate = new Date(msg.created_at);
            const prevMsgDate = index > 0 ? new Date(messages[index - 1].created_at) : null;
            const needsDateHeader = !prevMsgDate || currentMsgDate.toDateString() !== prevMsgDate.toDateString();
            
            let dateText = "";
            if (needsDateHeader) {
              const today = new Date();
              const yesterday = new Date(today);
              yesterday.setDate(yesterday.getDate() - 1);
              
              if (currentMsgDate.toDateString() === today.toDateString()) {
                dateText = "TODAY";
              } else if (currentMsgDate.toDateString() === yesterday.toDateString()) {
                dateText = "YESTERDAY";
              } else {
                dateText = currentMsgDate.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: currentMsgDate.getFullYear() !== today.getFullYear() ? "numeric" : undefined }).toUpperCase();
              }
            }

            return (
              <div key={msg.id} className="flex flex-col">
                {needsDateHeader && (
                  <div className="flex justify-center my-3">
                    <span className="text-[0.625rem] font-bold tracking-widest rounded-full px-3 py-1 bg-[var(--yrdly-glass-bg)] border border-[var(--yrdly-glass-border)] text-[var(--yrdly-label)] font-yrdly-display">
                      {dateText}
                    </span>
                  </div>
                )}
                <div className={`flex items-end gap-2.5 max-w-[85%] group ${isOwn ? "self-end flex-row-reverse" : "self-start"}`}>
                  {!isOwn && (
                    <Avatar className="w-7 h-7 flex-shrink-0">
                      <AvatarImage src={sender?.avatar_url} />
                      <AvatarFallback className="bg-primary text-foreground font-bold font-yrdly-display text-[10px]">
                        {sender?.name?.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  )}

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="opacity-0 group-hover:opacity-100 p-1 text-[var(--yrdly-label)] hover:text-foreground rounded-full transition-opacity self-center">
                        <MoreVertical className="w-3.5 h-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align={isOwn ? "end" : "start"} className="w-48 bg-[var(--yrdly-dark)] border border-[var(--yrdly-glass-border)] text-foreground font-yrdly-body">
                      {(msg.text || msg.content) && (
                        <DropdownMenuItem onClick={() => {
                          navigator.clipboard.writeText(msg.text || msg.content || "");
                          toast({ title: "Copied to clipboard" });
                        }} className="cursor-pointer">
                          <Copy className="w-3.5 h-3.5 mr-2" /> Copy text
                        </DropdownMenuItem>
                      )}
                      {isOwn && (msg.text || msg.content) && (
                        <DropdownMenuItem onClick={() => {
                          const val = msg.text || msg.content || "";
                          const updated = prompt("Edit message:", val);
                          if (updated && updated.trim() !== val) {
                            handleEditMessage(msg.id, updated);
                          }
                        }} className="cursor-pointer">
                          <Edit className="w-3.5 h-3.5 mr-2" /> Edit message
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onClick={() => handleDeleteMessageForMe(msg.id)} className="text-red-400 focus:text-red-400 cursor-pointer">
                        <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete for me
                      </DropdownMenuItem>
                      {isOwn && ((Date.now() - new Date(msg.created_at).getTime()) / 60000) <= 15 && (
                        <DropdownMenuItem onClick={() => handleDeleteMessageForEveryone(msg.id)} className="text-red-400 focus:text-red-400 cursor-pointer">
                          <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete for everyone
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <div className="flex flex-col gap-1">
                    {(msg.image_url || (msg.media_type === 'image' && msg.media_url)) && (
                      <div className="relative group rounded-2xl overflow-hidden border border-[var(--yrdly-glass-border)] cursor-pointer" style={{ maxWidth: 280 }} onClick={() => setFullscreenImage(msg.image_url || msg.media_url!)}>
                        <Image src={msg.image_url || msg.media_url!} alt="Message image" width={280} height={280} className="w-full h-auto object-cover" />
                        <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <span className="bg-black/50 text-white p-2 rounded-full backdrop-blur-sm">
                            <ImagePlus className="w-5 h-5" />
                          </span>
                        </div>
                      </div>
                    )}
                    {msg.video_url && (
                      <div className="rounded-2xl overflow-hidden relative group border border-[var(--yrdly-glass-border)]" style={{ maxWidth: 280, width: "100%", background: "#000" }}>
                        <video
                          src={msg.video_url.includes('#t=') ? msg.video_url : `${msg.video_url}#t=0.001`}
                          controls
                          playsInline
                          disablePictureInPicture
                          controlsList="nodownload noremoteplayback nopictureinpicture"
                          preload="metadata"
                          className="w-full h-auto"
                          style={{ maxHeight: 360 }}
                        />
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDownload(msg.video_url!, `video-${Date.now()}.mp4`);
                          }}
                          className="absolute top-2 right-2 p-2 bg-black/50 hover:bg-black/80 rounded-full text-white backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity z-10"
                          title="Download Video"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                    {(msg.text || msg.content) && (
                      <div
                        className={`px-4 py-2.5 text-xs leading-relaxed font-yrdly-body ${isOwn ? "bg-primary text-foreground rounded-[20px] rounded-br-[4px] font-semibold" : "bg-[var(--yrdly-glass-bg)] border border-[var(--yrdly-glass-border)] text-foreground rounded-[20px] rounded-bl-[4px]"}`}
                      >
                        {msg.text || msg.content}
                      </div>
                    )}
                    <span className={`text-[0.625rem] px-1 font-yrdly-body text-[var(--yrdly-label)] ${isOwn ? "text-right" : "text-left"}`}>
                      {formatTime(msg.created_at)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}

        {/* Typing indicator */}
        {otherTypingUsers.length > 0 && (
          <div className="flex items-center gap-2 self-start">
            <GlassCard className="flex items-center gap-2 rounded-full px-3 py-2">
              <div className="flex gap-1">
                {[0, 150, 300].map((delay) => (
                  <div key={delay} className="w-1.5 h-1.5 rounded-full animate-bounce bg-primary"
                    style={{ animationDelay: `-${delay}ms` }} />
                ))}
              </div>
              <span className="text-[0.65rem] text-[var(--yrdly-label)] font-yrdly-body">
                {otherTypingUsers[0]?.user_name} is typing...
              </span>
            </GlassCard>
          </div>
        )}

        <div ref={messagesEndRef} />
      </main>

      {/* ── Input ── */}
      <footer className="flex-shrink-0 p-4 pb-8 backdrop-blur-xl"
        style={{
          background: 'color-mix(in srgb, var(--c-card) 88%, transparent)',
          borderTop: "1px solid var(--c-border)",
          boxShadow: "0 -4px 20px rgba(0,0,0,0.10)",
        }}>
        {/* Image preview */}
        {imagePreview && (
          <div className="relative mb-3 inline-block">
            <Image src={imagePreview} alt="Preview" width={80} height={80} className="rounded-[10px] w-20 h-20 object-cover" />
            <button
              onClick={() => { setSelectedFile(null); setImagePreview(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
              className="absolute -top-2 -right-2 w-6 h-6 rounded-full text-foreground text-xs flex items-center justify-center"
              style={{ background: "#E53935" }}>×</button>
          </div>
        )}
        {/* Video preview */}
        {videoPreview && (
          <div className="relative mb-3 inline-block">
            <video src={videoPreview.includes('#t=') ? videoPreview : `${videoPreview}#t=0.001`} preload="metadata" className="rounded-[10px] w-20 h-20 object-cover" />
            <button
              onClick={() => { clearVideoPreview(); }}
              className="absolute -top-2 -right-2 w-6 h-6 rounded-full text-foreground text-xs flex items-center justify-center"
              style={{ background: "#E53935" }}>×</button>
          </div>
        )}
        <form onSubmit={handleSend} className="flex items-center gap-3">
          <button type="button" onClick={() => fileInputRef.current?.click()}
            className="p-2.5 rounded-full flex-shrink-0 transition-all duration-200 hover:scale-105 text-primary"
            style={{ background: "var(--c-card2)" }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "color-mix(in srgb, var(--primary) 15%, var(--c-card2))")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--c-card2)")}>
            <ImagePlus className="w-5 h-5" />
          </button>
          <button type="button" onClick={() => videoInputRef.current?.click()}
            className="p-2.5 rounded-full flex-shrink-0 transition-all duration-200 hover:scale-105 text-primary"
            style={{ background: "var(--c-card2)" }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "color-mix(in srgb, var(--primary) 15%, var(--c-card2))")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--c-card2)")}>
            <VideoIcon className="w-5 h-5" />
          </button>
          <div className="flex-1 relative">
            <input
              type="text"
              placeholder="Message..."
              value={newMessage}
              onChange={(e) => { setNewMessage(e.target.value); handleTyping(); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSend(e as any); } }}
              disabled={sending}
              className="w-full rounded-full px-5 py-3 text-base md:text-[0.875rem] text-foreground bg-[var(--yrdly-glass-bg)] border border-[var(--yrdly-glass-border)] font-yrdly-body outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <button
            type="submit"
            disabled={(!newMessage.trim() && !selectedFile && !videoFile) || sending}
            className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 bg-primary text-primary-foreground transition-all duration-200 active:scale-95 hover:scale-105 disabled:opacity-50 disabled:hover:scale-100 shadow-md">
            {sending ? <Loader2 className="w-5 h-5 text-primary-foreground animate-spin" /> : <Send className="w-5 h-5 text-primary-foreground" />}
          </button>
        </form>
        <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageSelect} className="hidden" />
        <input ref={videoInputRef} type="file" accept="video/mp4,video/webm,video/quicktime" onChange={handleVideoSelect} className="hidden" />
      </footer>

      {/* Fullscreen Image Modal */}
      {fullscreenImage && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 p-4 backdrop-blur-sm"
          onClick={() => setFullscreenImage(null)}
        >
          <div className="absolute top-4 right-4 flex gap-4 z-10">
            <button 
              onClick={(e) => {
                e.stopPropagation();
                handleDownload(fullscreenImage, `image-${Date.now()}.jpg`);
              }}
              className="text-white p-3 rounded-full bg-white/10 hover:bg-white/20 transition-colors backdrop-blur-md"
              title="Download Image"
            >
              <Download className="w-6 h-6" />
            </button>
            <button 
              onClick={() => setFullscreenImage(null)}
              className="text-white p-3 rounded-full bg-white/10 hover:bg-white/20 transition-colors backdrop-blur-md"
              title="Close"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img 
            src={fullscreenImage} 
            alt="Fullscreen" 
            className="max-w-full max-h-[90vh] object-contain rounded-md" 
            onClick={(e) => e.stopPropagation()} 
          />
        </div>
      )}
    </div>
  );
}