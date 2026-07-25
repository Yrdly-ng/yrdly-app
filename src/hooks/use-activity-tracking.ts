"use client";

import { useEffect, useCallback, useRef } from 'react';
import { useAuth } from './use-supabase-auth';
import { supabase } from '@/lib/supabase';

export function useActivityTracking() {
  const { user } = useAuth();
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null);
  const isOnlineRef = useRef(false);

  const updateUserStatus = useCallback(async (isOnline: boolean) => {
    if (!user) return;

    try {
      await supabase
        .from('users')
        .update({ 
          is_online: isOnline,
          last_seen: new Date().toISOString()
        })
        .eq('id', user.id);

      isOnlineRef.current = isOnline;
    } catch (error) {
      console.error('Error updating user status:', error);
    }
  }, [user]);

  const setUserOnline = useCallback(() => {
    updateUserStatus(true);
  }, [updateUserStatus]);

  const setUserOffline = useCallback(() => {
    updateUserStatus(false);
  }, [updateUserStatus]);

  // Heartbeat system - update status every 30 seconds while active
  const startHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
    }

    heartbeatRef.current = setInterval(() => {
      if (!document.hidden && user) {
        updateUserStatus(true);
      }
    }, 30000); // 30 seconds
  }, [user, updateUserStatus]);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  // Handle page visibility changes
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        setUserOffline();
        stopHeartbeat();
      } else {
        setUserOnline();
        startHeartbeat();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [setUserOnline, setUserOffline, startHeartbeat, stopHeartbeat]);

  // Handle page focus/blur
  useEffect(() => {
    const handleFocus = () => {
      if (user) {
        setUserOnline();
        startHeartbeat();
      }
    };

    const handleBlur = () => {
      setUserOffline();
      stopHeartbeat();
    };

    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
    };
  }, [user, setUserOnline, setUserOffline, startHeartbeat, stopHeartbeat]);

  // Initialize activity tracking when user logs in
  useEffect(() => {
    if (user) {
      setUserOnline();
      startHeartbeat();
    } else {
      stopHeartbeat();
    }

    // Cleanup on unmount
    return () => {
      if (user) {
        setUserOffline();
      }
      stopHeartbeat();
    };
  }, [user, setUserOnline, setUserOffline, startHeartbeat, stopHeartbeat]);

  // Handle beforeunload (page refresh/close)
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (user) {
        // Use navigator.sendBeacon for reliable offline status update
        const data = JSON.stringify({
          user_id: user.id,
          is_online: false,
          last_seen: new Date().toISOString()
        });
        
        navigator.sendBeacon('/api/user-status', data);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [user]);

  return {
    setUserOnline,
    setUserOffline,
    isOnline: isOnlineRef.current
  };
}
