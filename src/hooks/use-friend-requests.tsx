import * as Sentry from '@sentry/nextjs';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/use-supabase-auth';

export function useFriendRequests() {
  const { user } = useAuth();
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setPendingCount(0);
      setLoading(false);
      return;
    }

    const fetchPendingRequests = async () => {
      try {
        // Query for friend requests where the current user is the recipient
        const { data, error } = await supabase
          .from('friend_requests')
          .select('id')
          .eq('to_user_id', user.id)
          .eq('status', 'pending');

        if (error) {
          Sentry.captureException(error);
          setPendingCount(0);
        } else {
          setPendingCount(data?.length || 0);
        }
      } catch (error) {
        Sentry.captureException(error);
        setPendingCount(0);
      } finally {
        setLoading(false);
      }
    };

    fetchPendingRequests();

    // Set up real-time subscription for friend requests
    const channel = supabase
      .channel('friend_requests')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'friend_requests',
        filter: `to_user_id=eq.${user.id}`
      }, (payload) => {
        // Refresh the count when changes occur
        fetchPendingRequests();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  return { pendingCount, loading };
}
