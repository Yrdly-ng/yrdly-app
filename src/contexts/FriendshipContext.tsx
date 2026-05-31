"use client";

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-supabase-auth";

export type FriendshipStatus = "friends" | "request_sent" | "request_received" | "none";

interface FriendshipContextType {
  statuses: Record<string, FriendshipStatus>;
  updateStatus: (userId: string, status: FriendshipStatus) => void;
  getStatus: (userId: string) => FriendshipStatus;
  refreshUserStatus: (userId: string) => Promise<void>;
}

const FriendshipContext = createContext<FriendshipContextType | undefined>(undefined);

export function FriendshipProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [statuses, setStatuses] = useState<Record<string, FriendshipStatus>>({})

  const updateStatus = useCallback((userId: string, status: FriendshipStatus) => {
    setStatuses((prev) => ({
      ...prev,
      [userId]: status,
    }));
  }, []);

  const getStatus = useCallback((userId: string): FriendshipStatus => {
    return statuses[userId] || "none";
  }, [statuses]);

  const refreshUserStatus = useCallback(
    async (targetUserId: string) => {
      if (!user || targetUserId === user.id) return;

      try {
        // Check friends array first
        const [{ data: me }, { data: them }] = await Promise.all([
          supabase.from("users").select("friends").eq("id", user.id).single(),
          supabase.from("users").select("friends").eq("id", targetUserId).single()
        ]);

        if (me?.friends?.includes(targetUserId) || them?.friends?.includes(user.id)) {
          // Sync them if they are out of sync (optional, but for now just showing as friends)
          updateStatus(targetUserId, "friends");
          return;
        }

        // Check pending requests
        const { data: requests } = await supabase
          .from("friend_requests")
          .select("id, from_user_id, to_user_id, status")
          .eq("status", "pending")
          .or(
            `and(from_user_id.eq.${user.id},to_user_id.eq.${targetUserId}),and(from_user_id.eq.${targetUserId},to_user_id.eq.${user.id})`
          );

        if (requests && requests.length > 0) {
          const req = requests[0];
          const status: FriendshipStatus =
            req.from_user_id === user.id ? "request_sent" : "request_received";
          updateStatus(targetUserId, status);
        } else {
          updateStatus(targetUserId, "none");
        }
      } catch (error) {
        console.error("Error refreshing friendship status:", error);
      }
    },
    [user, updateStatus]
  );

  // Subscribe to friend_requests changes.
  // NOTE: Supabase realtime filters only support simple `column=eq.value` syntax,
  // NOT `or(...)`. So we create two separate channels — one for sent, one for received.
  useEffect(() => {
    if (!user) return;

    const handleChange = async (payload: { new?: unknown; old?: unknown }) => {
      const record = (payload.new || payload.old) as { from_user_id: string; to_user_id: string };
      if (!record) return;
      const otherUserId =
        record.from_user_id === user.id ? record.to_user_id : record.from_user_id;
      await refreshUserStatus(otherUserId);
    };

    // Channel for requests sent BY current user
    const sentChannel = supabase
      .channel(`friend_requests_sent:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "friend_requests",
          filter: `from_user_id=eq.${user.id}`,
        },
        handleChange
      )
      .subscribe();

    // Channel for requests received BY current user
    const receivedChannel = supabase
      .channel(`friend_requests_received:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "friend_requests",
          filter: `to_user_id=eq.${user.id}`,
        },
        handleChange
      )
      .subscribe();

    return () => {
      sentChannel.unsubscribe();
      receivedChannel.unsubscribe();
    };
  }, [user, refreshUserStatus]);

  return (
    <FriendshipContext.Provider value={{ statuses, updateStatus, getStatus, refreshUserStatus }}>
      {children}
    </FriendshipContext.Provider>
  );
}

export function useFriendshipContext() {
  const context = useContext(FriendshipContext);
  if (!context) {
    throw new Error("useFriendshipContext must be used within FriendshipProvider");
  }
  return context;
}
