"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, X, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useToast } from "@/hooks/use-toast";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";

const FONT = "var(--font-work-sans)";

interface SentRequest {
  id: string; // followers row id
  userId: string;
  name: string;
  username?: string;
  avatarUrl?: string;
}

export default function FriendRequestsSentPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();

  const [requests, setRequests] = useState<SentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const fetchSentRequests = useCallback(async () => {
    if (!user) return;
    try {
      setLoading(true);

      // Everyone I follow
      const { data: following, error: followingError } = await supabase
        .from("followers")
        .select("id, following_id")
        .eq("follower_id", user.id);

      if (followingError) throw followingError;
      if (!following || following.length === 0) {
        setRequests([]);
        return;
      }

      const targetIds = following.map((row: any) => row.following_id);

      // followers where they follow me back (i.e. following_id = me, follower_id in targetIds)
      const { data: reciprocalRows } = await supabase
        .from("followers")
        .select("follower_id")
        .eq("following_id", user.id)
        .in("follower_id", targetIds);

      const mutualIds = new Set((reciprocalRows || []).map((r: any) => r.follower_id));

      const pending = following.filter((row: any) => !mutualIds.has(row.following_id));

      if (pending.length === 0) {
        setRequests([]);
        return;
      }

      const { data: users, error: usersError } = await supabase
        .from("users")
        .select("id, name, username, avatar_url")
        .in("id", pending.map((row: any) => row.following_id));

      if (usersError) throw usersError;

      const usersById = new Map((users || []).map((u: any) => [u.id, u]));

      const mapped: SentRequest[] = pending
        .map((row: any) => {
          const u = usersById.get(row.following_id);
          if (!u) return null;
          return {
            id: row.id,
            userId: u.id,
            name: u.name || "User",
            username: u.username,
            avatarUrl: u.avatar_url,
          };
        })
        .filter(Boolean) as SentRequest[];

      setRequests(mapped);
    } catch (error) {
      console.error("Error fetching sent friend requests:", error);
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchSentRequests();
  }, [fetchSentRequests]);

  const handleCancel = async (targetUserId: string) => {
    if (!user) return;
    setCancellingId(targetUserId);
    try {
      const { error } = await supabase
        .from("followers")
        .delete()
        .eq("follower_id", user.id)
        .eq("following_id", targetUserId);

      if (error) throw error;

      try {
        await supabase
          .from("friend_requests")
          .delete()
          .eq("from_user_id", user.id)
          .eq("to_user_id", targetUserId)
          .eq("status", "pending");
      } catch {
        // non-fatal legacy cleanup
      }

      setRequests((prev) => prev.filter((r) => r.userId !== targetUserId));
      toast({ title: "Request cancelled" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Could not cancel this request.",
      });
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <div className="pb-6">
      {/* Header */}
      <div className="pt-1 pb-4">
        <h1 className="text-3xl text-foreground leading-tight" style={{ fontFamily: FONT, fontWeight: 700 }}>
          Sent Requests
        </h1>
        <p className="text-sm" style={{ color: "var(--c-text-muted)", fontFamily: FONT }}>
          Friend requests you've sent that are still pending
        </p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-xl border border-border/50">
              <Skeleton className="h-11 w-11 rounded-full" />
              <div className="space-y-2 flex-1">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-20" />
              </div>
              <Skeleton className="h-8 w-8 rounded-full" />
            </div>
          ))}
        </div>
      ) : requests.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center rounded-2xl border border-border/50">
          <UserPlus className="w-10 h-10 mb-3" style={{ color: "var(--c-text-muted)", opacity: 0.5 }} />
          <p className="text-sm font-semibold text-foreground" style={{ fontFamily: FONT }}>
            No pending requests
          </p>
          <p className="text-xs mt-1" style={{ color: "var(--c-text-muted)", fontFamily: FONT }}>
            Requests you send to other people will show up here.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {requests.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between p-3 rounded-xl border border-border/50 bg-card hover:bg-muted/30 transition-colors"
            >
              <div
                className="flex items-center gap-3 min-w-0 cursor-pointer"
                onClick={() => router.push(`/profile/${r.userId}`)}
              >
                <Avatar className="h-11 w-11 border border-border/40">
                  <AvatarImage src={r.avatarUrl || undefined} alt={r.name} />
                  <AvatarFallback className="bg-primary/10 text-primary font-bold text-xs">
                    {r.name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate" style={{ fontFamily: FONT }}>
                    {r.name}
                  </p>
                  {r.username && (
                    <p className="text-xs truncate" style={{ color: "var(--c-text-muted)", fontFamily: FONT }}>
                      @{r.username}
                    </p>
                  )}
                </div>
              </div>

              <button
                onClick={() => handleCancel(r.userId)}
                disabled={cancellingId === r.userId}
                className="shrink-0 ml-2 flex items-center justify-center w-8 h-8 rounded-full border border-border/60 text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/40 transition-colors disabled:opacity-50"
                aria-label="Cancel request"
              >
                {cancellingId === r.userId ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <X className="w-4 h-4" />
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
