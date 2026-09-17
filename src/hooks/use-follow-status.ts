"use client";

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from './use-supabase-auth';

export function useFollowStatus(targetId?: string) {
  const { user } = useAuth();
  const [isFollowing, setIsFollowing] = useState(false);
  const [loading, setLoading] = useState(true);

  const checkStatus = useCallback(async () => {
    if (!user || !targetId) {
      setIsFollowing(false);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('followers')
        .select('id')
        .eq('follower_id', user.id)
        .eq('following_id', targetId)
        .maybeSingle();

      if (error) throw error;
      setIsFollowing(!!data);
    } catch (e) {
      console.error('Error checking follow status:', e);
      setIsFollowing(false);
    } finally {
      setLoading(false);
    }
  }, [user, targetId]);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const toggleFollow = async () => {
    if (!user || !targetId) return;

    try {
      if (isFollowing) {
        const { error } = await supabase
          .from('followers')
          .delete()
          .eq('follower_id', user.id)
          .eq('following_id', targetId);

        if (error) throw error;
        setIsFollowing(false);
      } else {
        const { error } = await supabase
          .from('followers')
          .insert({
            follower_id: user.id,
            following_id: targetId,
          });

        if (error) throw error;
        setIsFollowing(true);
      }
    } catch (e) {
      console.error('Error toggling follow:', e);
    }
  };

  return {
    isFollowing,
    loading,
    toggleFollow,
    checkStatus,
  };
}
