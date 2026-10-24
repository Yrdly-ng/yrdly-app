"use client";

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase/supabase';
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
  const { user: currentUser, profile, updateProfile } = useAuth();

  const [friends, setFriends] = useState<FriendItem[]>([]);
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [discoverUsers, setDiscoverUsers] = useState<any[]>([]);
  const [coordinates, setCoordinates] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState<Record<string, boolean>>({});

  const fetchConnections = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      const [{ data: followingData }, { data: followersData }] = await Promise.all([
        supabase
          .from('followers')
          .select(`following_id, following:public_profiles!followers_following_id_fkey(id, name, avatar_url, username)`)
          .eq('follower_id', currentUser.id),
        supabase
          .from('followers')
          .select(`follower_id, follower:public_profiles!followers_follower_id_fkey(id, name, avatar_url, username)`)
          .eq('following_id', currentUser.id),
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

    } catch (e) {
      console.error('Error fetching community connections:', e);
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  const findNearbyPeople = useCallback(async (radiusMeters = 10000) => {
    if (!currentUser) return;
    setLocationBusy(true);
    setLocationError(null);
    try {
      if (!profile?.nearby_enabled) await updateProfile({ nearby_enabled: true });
      if (!navigator.geolocation) throw new Error('Location is unavailable in this browser.');
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, () => reject(new Error('Allow location access in your browser to find people nearby.')), {
          enableHighAccuracy: false,
          maximumAge: 60_000,
          timeout: 12_000,
        });
      });
      const nextCoordinates = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
      const { error: presenceError } = await supabase.rpc('upsert_nearby_presence', {
        p_latitude: nextCoordinates.latitude,
        p_longitude: nextCoordinates.longitude,
      });
      if (presenceError) throw presenceError;
      setCoordinates(nextCoordinates);
      const { data, error } = await supabase.rpc('nearby_people', {
        p_latitude: nextCoordinates.latitude,
        p_longitude: nextCoordinates.longitude,
        p_radius_meters: radiusMeters,
        p_filter: activeFilterTab,
        p_search: search.trim() || null,
        p_limit: 20,
        p_offset: 0,
      });
      if (error) throw error;
      setDiscoverUsers(Array.isArray(data) ? data : []);
    } catch (error) {
      setLocationError(error instanceof Error ? error.message : 'Could not find nearby people.');
    } finally {
      setLocationBusy(false);
    }
  }, [currentUser, profile?.nearby_enabled, updateProfile, activeFilterTab, search]);

  useEffect(() => {
    if (!coordinates) return;
    const refresh = async () => {
      const { error: presenceError } = await supabase.rpc('upsert_nearby_presence', {
        p_latitude: coordinates.latitude,
        p_longitude: coordinates.longitude,
      });
      if (presenceError) return;
      const { data, error } = await supabase.rpc('nearby_people', {
        p_latitude: coordinates.latitude,
        p_longitude: coordinates.longitude,
        p_radius_meters: 10000,
        p_filter: activeFilterTab,
        p_search: search.trim() || null,
        p_limit: 20,
        p_offset: 0,
      });
      if (!error) setDiscoverUsers(Array.isArray(data) ? data : []);
    };
    void refresh();
  }, [coordinates, activeFilterTab, search]);

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
    findNearbyPeople,
    locationBusy,
    locationError,
    loading,
    actionInProgress,
    followUser,
    unfollowUser,
    refreshConnections: fetchConnections,
  };
}
