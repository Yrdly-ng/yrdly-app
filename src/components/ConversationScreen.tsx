"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/hooks/use-supabase-auth";
import { supabase } from "@/lib/supabase";
import { StorageService } from "@/lib/storage-service";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ArrowLeft, ImagePlus, VideoIcon, Send, MessageCircle, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { ActivityIndicator } from "@/components/ActivityIndicator";
import { useTypingDetection } from "@/hooks/use-typing-detection";
import type { User } from "@/types";
import Image from "next/image";

const GREEN = "#388E3C";
const CARD = "var(--c-card)";
const BG = "var(--c-bg)";
const FONT = "Inter, sans-serif";

interface ConversationRow {
  id: string;
  participant_ids: string[];
  last_message_text: string | null;
  last_message_timestamp: string | null;
  last_message_sender_id: string | null;
  created_at: string;
  updated_at: string;
  context?: any;
}

interface ChatMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  text: string;
  content?: string;
  image_url: string | null;
  video_url?: string | null;
  created_at: string;
  is_read: boolean;
  read_by?: string[];
}

interface ConversationScreenProps {
  conversationId: string;
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

export function ConversationScreen({ conversationId }: ConversationScreenProps) {
  const { user } = useAuth();
  const router = useRouter();

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

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const { otherTypingUsers, handleTyping, stopTyping } = useTypingDetection(conversationId);

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
      setMessages(data || []);
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
        .update({ context: newContext, unread_count: 0, updated_at: new Date().toISOString() })
        .eq("id", conversation.id);
    };
    mark();
  }, [conversation, user]);

  /* ── Real-time messages ── */
  useEffect(() => {
    if (!conversation) return;
    const ch = supabase.channel(`messages-${conversation.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `conversation_id=eq.${conversation.id}` },
        (payload) => {
          if (payload.eventType === "INSERT") setMessages((p) => [...p, payload.new as ChatMessage]);
          else if (payload.eventType === "UPDATE") setMessages((p) => p.map((m) => m.id === payload.new.id ? payload.new as ChatMessage : m));
          else if (payload.eventType === "DELETE") setMessages((p) => p.filter((m) => m.id !== payload.old.id));
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [conversation]);

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
        created_at: new Date().toISOString(), is_read: true, read_by: [user.id],
      });
      await supabase.from("conversations").update({
        updated_at: new Date().toISOString(),
        last_message_text: newMessage.trim() || (videoUrl ? "🎬 Video" : imageUrl ? "📷 Photo" : ""),
        last_message_timestamp: new Date().toISOString(),
        last_message_sender_id: user.id,
      }).eq("id", conversation.id);

      const others = conversation.participant_ids.filter((id) => id !== user.id);
      for (const pid of others) {
        try {
          const { NotificationTriggers } = await import("@/lib/notification-triggers");
          await NotificationTriggers.onMessageSent(pid, user.id, conversation.id, newMessage.trim() || (videoUrl ? "🎬 Video" : imageUrl ? "📷 Photo" : ""));
        } catch {}
      }
      setNewMessage(""); setSelectedFile(null); setImagePreview(null);
      setVideoFile(null); setVideoPreview(null);
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

  const handleVideoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const MAX = 15 * 1024 * 1024;
    const ALLOWED = ['video/mp4', 'video/webm', 'video/quicktime'];
    if (!ALLOWED.includes(file.type) || file.size > MAX) return;
    setVideoFile(file);
    setVideoPreview(URL.createObjectURL(file));
    if (videoInputRef.current) videoInputRef.current.value = '';
  };

  /* ─── Render ─── */
  if (loading) {
    return (
      <div className="flex flex-col h-full" style={{ background: BG }}>
        <div className="h-16 animate-pulse" style={{ background: CARD }} />
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 rounded-full border-2 border-[#388E3C] border-t-transparent animate-spin" />
        </div>
      </div>
    );
  }

  if (!conversation || !otherParticipant) {
    return (
      <div className="flex flex-col h-full items-center justify-center" style={{ background: BG }}>
        <MessageCircle className="w-12 h-12 mb-4" style={{ color: GREEN, opacity: 0.4 }} />
        <p className="text-foreground mb-4" style={{ fontFamily: FONT }}>Conversation not found</p>
        <button onClick={() => router.push("/messages")} className="rounded-full px-6 py-2 text-foreground text-sm" style={{ background: GREEN, fontFamily: FONT }}>
          Back to Messages
        </button>
      </div>
    );
  }

  const activityStatus = getActivityStatus((otherParticipant as any).last_seen);

  return (
    <div className="flex flex-col h-full" style={{ background: BG }}>
      {/* ── Header ── */}
      <header className="flex items-center px-4 py-3 flex-shrink-0"
        style={{ background: 'var(--c-card)', boxShadow: "0 2px 8px rgba(0,0,0,0.3)" }}>
        <button onClick={() => router.push("/messages")} className="mr-3 p-2 rounded-full transition-colors"
          style={{ color: "var(--c-text)" }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.opacity = "0.8")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}>
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="relative cursor-pointer" onClick={() => router.push(`/profile/${otherParticipant.id}`)}>
          <Avatar className="w-12 h-12">
            <AvatarImage src={otherParticipant.avatar_url} alt={otherParticipant.name} />
            <AvatarFallback style={{ background: GREEN, color: "#fff", fontFamily: FONT, fontWeight: 700 }}>
              {otherParticipant.name?.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="absolute -bottom-0.5 -right-0.5">
            <ActivityIndicator userId={otherParticipant.id} size="sm" />
          </div>
        </div>
        <div className="ml-3 flex-1 min-w-0">
          <h1 className="text-[1rem] font-bold text-foreground truncate" style={{ fontFamily: "Inter, sans-serif" }}>
            {otherParticipant.name}
          </h1>
          <p className="text-[0.75rem]" style={{ fontFamily: FONT, color: "var(--c-text-muted)" }}>
            {activityStatus}
          </p>
        </div>
      </header>

      {/* ── Messages ── */}
      <main className="flex-1 overflow-y-auto px-4 py-6 space-y-4" style={{ background: BG }}>
        {/* Date marker */}
        <div className="flex justify-center">
          <span className="text-[0.625rem] font-bold uppercase tracking-widest rounded-full px-3 py-1"
            style={{ color: "var(--c-text-muted)", background: "var(--c-card)", fontFamily: FONT }}>Today</span>
        </div>

        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <MessageCircle className="w-12 h-12 mb-3" style={{ color: GREEN, opacity: 0.4 }} />
            <p className="text-foreground text-sm" style={{ fontFamily: FONT }}>No messages yet. Say hello!</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isOwn = msg.sender_id === user?.id;
            const sender = participants[msg.sender_id];
            return (
              <div key={msg.id} className={`flex items-end gap-3 max-w-[85%] ${isOwn ? "self-end ml-auto flex-row-reverse" : "self-start"}`}>
                {!isOwn && (
                  <Avatar className="w-8 h-8 flex-shrink-0">
                    <AvatarImage src={sender?.avatar_url} />
                    <AvatarFallback style={{ background: GREEN, color: "#fff", fontFamily: FONT, fontWeight: 700, fontSize: 12 }}>
                      {sender?.name?.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                )}
                <div className="flex flex-col gap-1">
                  {msg.image_url && (
                    <div className="rounded-[10px] overflow-hidden border" style={{ borderColor: "var(--c-border)", maxWidth: 192 }}>
                      <Image src={msg.image_url} alt="Message image" width={192} height={192} className="w-full h-auto object-cover" />
                    </div>
                  )}
                  {msg.video_url && (
                    <div className="rounded-[10px] overflow-hidden" style={{ maxWidth: 220 }}>
                      <video
                        src={msg.video_url.includes('#t=') ? msg.video_url : `${msg.video_url}#t=0.001`}
                        controls
                        playsInline
                        preload="metadata"
                        className="w-full h-auto"
                        style={{ maxHeight: 160 }}
                      />
                    </div>
                  )}
                  {(msg.text || msg.content) && (
                    <div
                      className="px-4 py-3 text-foreground text-[0.8125rem] leading-relaxed"
                      style={{
                        background: isOwn ? GREEN : CARD,
                        borderRadius: isOwn ? "20px 20px 4px 20px" : "20px 20px 20px 4px",
                        fontFamily: FONT,
                      }}
                    >
                      {msg.text || msg.content}
                    </div>
                  )}
                  <span className={`text-[0.625rem] ${isOwn ? "text-right mr-1" : "ml-1"}`} style={{ color: "var(--c-text-muted)", fontFamily: FONT }}>
                    {formatTime(msg.created_at)}
                  </span>
                </div>
              </div>
            );
          })
        )}

        {/* Typing indicator */}
        {otherTypingUsers.length > 0 && (
          <div className="flex items-center gap-2 self-start">
            <div className="flex items-center gap-2 rounded-full px-3 py-2" style={{ background: "var(--c-card2)" }}>
              <div className="flex gap-1">
                {[0, 150, 300].map((delay) => (
                  <div key={delay} className="w-1.5 h-1.5 rounded-full animate-bounce"
                    style={{ background: GREEN, animationDelay: `-${delay}ms` }} />
                ))}
              </div>
              <span className="text-[0.75rem]" style={{ color: "var(--c-text-muted)", fontFamily: FONT }}>
                {otherTypingUsers[0]?.user_name} is typing...
              </span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </main>

      {/* ── Input ── */}
      <footer className="flex-shrink-0 p-4 pb-8" style={{ background: 'var(--c-card)', borderTop: "0.5px solid var(--c-border)" }}>
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
              onClick={() => { setVideoFile(null); setVideoPreview(null); }}
              className="absolute -top-2 -right-2 w-6 h-6 rounded-full text-foreground text-xs flex items-center justify-center"
              style={{ background: "#E53935" }}>×</button>
          </div>
        )}
        <form onSubmit={handleSend} className="flex items-center gap-3">
          <button type="button" onClick={() => fileInputRef.current?.click()}
            className="p-2 rounded-full flex-shrink-0 transition-colors"
            style={{ color: GREEN }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.opacity = "0.8")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}>
            <ImagePlus className="w-6 h-6" />
          </button>
          <button type="button" onClick={() => videoInputRef.current?.click()}
            className="p-2 rounded-full flex-shrink-0 transition-colors"
            style={{ color: GREEN }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.opacity = "0.8")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}>
            <VideoIcon className="w-6 h-6" />
          </button>
          <div className="flex-1 relative">
            <input
              type="text"
              placeholder="Message..."
              value={newMessage}
              onChange={(e) => { setNewMessage(e.target.value); handleTyping(); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSend(e as any); } }}
              disabled={sending}
              className="w-full rounded-full px-5 py-3 text-[0.875rem] text-foreground outline-none focus:ring-1 focus:ring-[#388E3C]"
              style={{ background: "var(--c-card2)", fontFamily: FONT, caretColor: GREEN }}
            />
          </div>
          <button
            type="submit"
            disabled={(!newMessage.trim() && !selectedFile && !videoFile) || sending}
            className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 transition-transform active:scale-95 shadow-lg"
            style={{ background: GREEN }}>
            {sending ? <Loader2 className="w-5 h-5 text-foreground animate-spin" /> : <Send className="w-5 h-5 text-foreground" />}
          </button>
        </form>
        <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageSelect} className="hidden" />
        <input ref={videoInputRef} type="file" accept="video/mp4,video/webm,video/quicktime" onChange={handleVideoSelect} className="hidden" />
      </footer>
    </div>
  );
}
