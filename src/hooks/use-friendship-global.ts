"use client";

import { useCallback, useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "./use-supabase-auth";
import { useToast } from "./use-toast";
import { useFriendshipContext } from "@/contexts/FriendshipContext";
import type { FriendshipStatus } from "@/contexts/FriendshipContext";

interface UseFriendshipGlobalReturn {
  status: FriendshipStatus;
  isLoading: boolean;
  error: string | null;
  addFriend: () => Promise<void>;
  removeFriend: () => Promise<void>;
  cancelRequest: () => Promise<void>;
  acceptRequest: () => Promise<void>;
  declineRequest: () => Promise<void>;
}

export function useFriendshipGlobal(targetUserId: string | undefined): UseFriendshipGlobalReturn {
  const { user } = useAuth();
  const { toast } = useToast();
  const { getStatus, refreshUserStatus } = useFriendshipContext();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize status on mount or when targetUserId changes
  useEffect(() => {
    if (!user || !targetUserId || targetUserId === user.id) return;
    
    const initStatus = async () => {
      await refreshUserStatus(targetUserId);
    };
    
    initStatus();
  }, [user, targetUserId, refreshUserStatus]);

  const status = targetUserId ? getStatus(targetUserId) : "none";

  const addFriend = useCallback(async () => {
    if (!user || !targetUserId) return;

    try {
      setIsLoading(true);
      setError(null);

      // Check if already following in followers table
      const { data: existing } = await supabase
        .from("followers")
        .select("id")
        .eq("follower_id", user.id)
        .eq("following_id", targetUserId)
        .maybeSingle();

      if (existing) {
        toast({
          title: "Already following",
          description: "You have already sent a request or followed this user.",
        });
        return;
      }

      const { error: insertError } = await supabase.from("followers").insert({
        follower_id: user.id,
        following_id: targetUserId,
      });

      if (insertError) throw new Error(insertError.message);

      // Also insert into friend_requests for legacy backward-compatibility
      try {
        await supabase.from("friend_requests").insert({
          from_user_id: user.id,
          to_user_id: targetUserId,
          participant_ids: [user.id, targetUserId].sort(),
          status: "pending",
          created_at: new Date().toISOString(),
        });
      } catch {
        // Non-fatal if legacy table errors
      }

      await refreshUserStatus(targetUserId);

      toast({
        title: "Success",
        description: "Friend request sent!",
      });

      try {
        const { NotificationTriggers } = await import("@/lib/notification-triggers");
        await NotificationTriggers.onFriendRequestSent(user.id, targetUserId);
      } catch {
        // Non-fatal
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Could not send friend request";
      setError(errorMessage);
      toast({
        variant: "destructive",
        title: "Error",
        description: errorMessage,
      });
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [user, targetUserId, toast, refreshUserStatus]);

  const removeFriend = useCallback(async () => {
    if (!user || !targetUserId) return;

    try {
      setIsLoading(true);
      setError(null);

      // Delete both directions from followers table
      await Promise.all([
        supabase
          .from("followers")
          .delete()
          .eq("follower_id", user.id)
          .eq("following_id", targetUserId),
        supabase
          .from("followers")
          .delete()
          .eq("follower_id", targetUserId)
          .eq("following_id", user.id),
      ]);

      // Legacy cleanup for friend_requests & users.friends
      try {
        const [{ data: meData }, { data: themData }] = await Promise.all([
          supabase.from("users").select("friends").eq("id", user.id).single(),
          supabase.from("users").select("friends").eq("id", targetUserId).single(),
        ]);
        const updatedMyFriends = (meData?.friends || []).filter((id: string) => id !== targetUserId);
        const updatedTheirFriends = (themData?.friends || []).filter((id: string) => id !== user.id);
        await Promise.all([
          supabase.from("users").update({ friends: updatedMyFriends }).eq("id", user.id),
          supabase.from("users").update({ friends: updatedTheirFriends }).eq("id", targetUserId),
          supabase
            .from("friend_requests")
            .delete()
            .or(
              `and(from_user_id.eq.${user.id},to_user_id.eq.${targetUserId}),` +
              `and(from_user_id.eq.${targetUserId},to_user_id.eq.${user.id})`
            ),
        ]);
      } catch {
        // Non-fatal
      }

      await refreshUserStatus(targetUserId);

      toast({
        title: "Success",
        description: "Friend removed",
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Could not remove friend";
      setError(errorMessage);
      toast({
        variant: "destructive",
        title: "Error",
        description: errorMessage,
      });
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [user, targetUserId, toast, refreshUserStatus]);

  const cancelRequest = useCallback(async () => {
    if (!user || !targetUserId) return;

    try {
      setIsLoading(true);
      setError(null);

      const { error: deleteError } = await supabase
        .from("followers")
        .delete()
        .eq("follower_id", user.id)
        .eq("following_id", targetUserId);

      if (deleteError) throw new Error(deleteError.message);

      try {
        await supabase
          .from("friend_requests")
          .delete()
          .eq("from_user_id", user.id)
          .eq("to_user_id", targetUserId)
          .eq("status", "pending");
      } catch {
        // Non-fatal
      }

      await refreshUserStatus(targetUserId);

      toast({
        title: "Success",
        description: "Request cancelled",
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Could not cancel request";
      setError(errorMessage);
      toast({
        variant: "destructive",
        title: "Error",
        description: errorMessage,
      });
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [user, targetUserId, toast, refreshUserStatus]);

  const acceptRequest = useCallback(async () => {
    if (!user || !targetUserId) return;

    try {
      setIsLoading(true);
      setError(null);

      // Insert reciprocal follow row into followers table to create mutual follow (Friends)
      const { error: insertError } = await supabase.from("followers").insert({
        follower_id: user.id,
        following_id: targetUserId,
      });

      if (insertError && !insertError.message.includes("duplicate")) {
        throw new Error(insertError.message);
      }

      // Legacy update for friend_requests & users.friends
      try {
        await supabase
          .from("friend_requests")
          .update({ status: "accepted", updated_at: new Date().toISOString() })
          .eq("from_user_id", targetUserId)
          .eq("to_user_id", user.id);

        const [{ data: meData }, { data: themData }] = await Promise.all([
          supabase.from("users").select("friends").eq("id", user.id).single(),
          supabase.from("users").select("friends").eq("id", targetUserId).single(),
        ]);
        const myFriends = Array.from(new Set([...(meData?.friends || []), targetUserId]));
        const theirFriends = Array.from(new Set([...(themData?.friends || []), user.id]));
        await Promise.all([
          supabase.from("users").update({ friends: myFriends }).eq("id", user.id),
          supabase.from("users").update({ friends: theirFriends }).eq("id", targetUserId),
        ]);
      } catch {
        // Non-fatal
      }

      await refreshUserStatus(targetUserId);

      toast({
        title: "Success",
        description: "Friend request accepted!",
      });

      try {
        const { NotificationTriggers } = await import("@/lib/notification-triggers");
        await NotificationTriggers.onFriendRequestAccepted(targetUserId, user.id);
      } catch {
        // Non-fatal
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Could not accept request";
      setError(errorMessage);
      toast({
        variant: "destructive",
        title: "Error",
        description: errorMessage,
      });
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [user, targetUserId, toast, refreshUserStatus]);

  const declineRequest = useCallback(async () => {
    if (!user || !targetUserId) return;

    try {
      setIsLoading(true);
      setError(null);

      const { error: deleteError } = await supabase
        .from("followers")
        .delete()
        .eq("follower_id", targetUserId)
        .eq("following_id", user.id);

      if (deleteError) throw new Error(deleteError.message);

      try {
        await supabase
          .from("friend_requests")
          .delete()
          .eq("from_user_id", targetUserId)
          .eq("to_user_id", user.id);
      } catch {
        // Non-fatal
      }

      await refreshUserStatus(targetUserId);

      toast({
        title: "Success",
        description: "Friend request rejected",
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Could not reject request";
      setError(errorMessage);
      toast({
        variant: "destructive",
        title: "Error",
        description: errorMessage,
      });
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [user, targetUserId, toast, refreshUserStatus]);

  return {
    status,
    isLoading,
    error,
    addFriend,
    removeFriend,
    cancelRequest,
    acceptRequest,
    declineRequest,
  };
}
