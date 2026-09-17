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
        const [{ data: iFollowThem }, { data: theyFollowMe }] = await Promise.all([
          supabase
            .from("followers")
            .select("id")
            .eq("follower_id", user.id)
            .eq("following_id", targetUserId)
            .maybeSingle(),
          supabase
            .from("followers")
            .select("id")
            .eq("follower_id", targetUserId)
            .eq("following_id", user.id)
            .maybeSingle(),
        ]);

        const followsThem = !!iFollowThem;
        const followsMe = !!theyFollowMe;

        if (followsThem && followsMe) {
          updateStatus(targetUserId, "friends");
        } else if (followsThem) {
          updateStatus(targetUserId, "request_sent");
        } else if (followsMe) {
          updateStatus(targetUserId, "request_received");
        } else {
          updateStatus(targetUserId, "none");
        }
      } catch (error) {
        console.error("Error refreshing friendship status:", error);
      }
    },
    [user, updateStatus]
  );

  // Subscribe to followers table changes
  useEffect(() => {
    if (!user) return;

    const handleChange = async (payload: { new?: any; old?: any }) => {
      const record = payload.new || payload.old;
      if (!record) return;
      const otherUserId =
        record.follower_id === user.id ? record.following_id : record.follower_id;
      if (otherUserId) {
        await refreshUserStatus(otherUserId);
      }
    };

    const followingChannel = supabase
      .channel(`community_following:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "followers",
          filter: `follower_id=eq.${user.id}`,
        },
        handleChange
      )
      .subscribe();

    const followersChannel = supabase
      .channel(`community_followers:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "followers",
          filter: `following_id=eq.${user.id}`,
        },
        handleChange
      )
      .subscribe();

    return () => {
      followingChannel.unsubscribe();
      followersChannel.unsubscribe();
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
