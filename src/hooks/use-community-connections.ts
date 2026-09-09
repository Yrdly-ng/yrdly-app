"use client";

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from './use-supabase-auth';

export type CommunityFilterTab = 'all' | 'neighbors' | 'mutuals' | 'sellers';

export interface FriendItem {
  reqId: string;
  user: any;
}

export interface RequestItem {
  id: string;
  from_user: any;
}

export function useCommunityConnections(
  activeFilterTab: CommunityFilterTab = 'all',
  search: string = ''
) {
  const { user: currentUser } = useAuth();

  const [friends, setFriends] = useState<FriendItem[]>([]);
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [discoverUsers, setDiscoverUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState<Record<string, boolean>>({});

  const fetchConnections = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      const [{ data: followingData }, { data: followersData }, { data: discoverData }] = await Promise.all([
        supabase
          .from('followers')
          .select(`following_id, following:users!followers_following_id_fkey(id, name, avatar_url, username)`)
          .eq('follower_id', currentUser.id),
        supabase
          .from('followers')
          .select(`follower_id, follower:users!followers_follower_id_fkey(id, name, avatar_url, username)`)
          .eq('following_id', currentUser.id),
        supabase
          .from('users')
          .select('id, name, username, avatar_url, bio')
          .neq('id', currentUser.id)
          .limit(20),
      ]);

      const followingList = followingData || [];
      const followersList = followersData || [];

      const followingIds = new Set(followingList.map((f) => f.following_id));
      const followerIds = new Set(followersList.map((f) => f.follower_id));

      const mutualFriends: FriendItem[] = [];
      followingList.forEach((f) => {
        if (followerIds.has(f.following_id) && f.following) {
          mutualFriends.push({
            reqId: f.following_id,
            user: f.following,
          });
        }
      });

      const incomingRequests: RequestItem[] = [];
      followersList.forEach((f) => {
        if (!followingIds.has(f.follower_id) && f.follower) {
          incomingRequests.push({
            id: f.follower_id,
            from_user: f.follower,
          });
        }
      });

      setFriends(mutualFriends);
      setRequests(incomingRequests);

      // Filter out users already followed from discover
      const availableDiscover = (discoverData || []).filter(u => !followingIds.has(u.id));
      setDiscoverUsers(availableDiscover);
    } catch (e) {
      console.error('Error fetching community connections:', e);
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  const followUser = async (targetUserId: string) => {
    if (!currentUser) return;
    setActionInProgress((prev) => ({ ...prev, [targetUserId]: true }));
    try {
      const { error } = await supabase
        .from('followers')
        .insert({ follower_id: currentUser.id, following_id: targetUserId });

      if (error) throw error;
      await fetchConnections();
    } catch (e) {
      console.error('Error following user:', e);
    } finally {
      setActionInProgress((prev) => ({ ...prev, [targetUserId]: false }));
    }
  };

  const unfollowUser = async (targetUserId: string) => {
    if (!currentUser) return;
    setActionInProgress((prev) => ({ ...prev, [targetUserId]: true }));
    try {
      const { error } = await supabase
        .from('followers')
        .delete()
        .eq('follower_id', currentUser.id)
        .eq('following_id', targetUserId);

      if (error) throw error;
      await fetchConnections();
    } catch (e) {
      console.error('Error unfollowing user:', e);
    } finally {
      setActionInProgress((prev) => ({ ...prev, [targetUserId]: false }));
    }
  };

  return {
    friends,
    requests,
    discoverUsers,
    loading,
    actionInProgress,
    followUser,
    unfollowUser,
    refreshConnections: fetchConnections,
  };
}
