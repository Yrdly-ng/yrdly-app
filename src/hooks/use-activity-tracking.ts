"use client";

import { useEffect, useCallback, useRef } from 'react';
import { useAuth } from './use-supabase-auth';
import { supabase } from '@/lib/supabase/supabase';

export function useActivityTracking() {
  const { user } = useAuth();
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null);
  const isOnlineRef = useRef(false);
  const lastStatusRequestRef = useRef<{ userId: string; isOnline: boolean; at: number } | null>(null);

  const updateUserStatus = useCallback(async (isOnline: boolean) => {
    if (!user) return;

    const now = Date.now();
    const previous = lastStatusRequestRef.current;
    if (previous?.userId === user.id && previous.isOnline === isOnline && now - previous.at < 15000) return;
    lastStatusRequestRef.current = { userId: user.id, isOnline, at: now };

    try {
      const { error } = await supabase
        .from('users')
        .update({
          is_online: isOnline,
          last_seen: new Date().toISOString()
        })
        .eq('id', user.id);

      if (error) throw error;
      isOnlineRef.current = isOnline;
    } catch (error) {
      console.error('Error updating user status:', error);
    }
  }, [user]);

  const setUserOnline = useCallback(() => {
    void updateUserStatus(true);
  }, [updateUserStatus]);

  const setUserOffline = useCallback(() => {
    void updateUserStatus(false);
  }, [updateUserStatus]);

  // Keep active presence fresh without writing to Postgres every 30 seconds.
  // Focus and visibility transitions still update status immediately.
  const startHeartbeat = useCallback(() => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = setInterval(() => {
      if (!document.hidden && user) void updateUserStatus(true);
    }, 120000);
  }, [user, updateUserStatus]);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

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

  useEffect(() => {
    if (user) {
      setUserOnline();
      startHeartbeat();
    } else {
      stopHeartbeat();
    }

    return () => {
      if (user) setUserOffline();
      stopHeartbeat();
    };
  }, [user, setUserOnline, setUserOffline, startHeartbeat, stopHeartbeat]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (!user) return;
      const data = JSON.stringify({
        user_id: user.id,
        is_online: false,
        last_seen: new Date().toISOString()
      });
      navigator.sendBeacon('/api/user-status', data);
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
