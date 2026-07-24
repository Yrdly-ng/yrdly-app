"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from './use-supabase-auth';
import { supabase } from '@/lib/supabase';

interface TypingUser {
  user_id: string;
  user_name: string;
  is_typing: boolean;
  updated_at: string;
}

export function useTypingDetection(conversationId: string) {
  const { user } = useAuth();
  const [isTyping, setIsTyping] = useState(false);
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Send typing status to database
  const sendTypingStatus = useCallback(async (typing: boolean) => {
    if (!user || !conversationId) return;

    try {
      await supabase
        .from('typing_status')
        .upsert({
          conversation_id: conversationId,
          user_id: user.id,
          is_typing: typing,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'conversation_id,user_id'
        });
    } catch (error) {
      console.error('Error sending typing status:', error);
    }
  }, [user, conversationId]);

  // Debounced typing status update
  const debouncedTypingStatus = useCallback(
    (typing: boolean) => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      
      debounceTimeoutRef.current = setTimeout(() => {
        sendTypingStatus(typing);
      }, 300); // 300ms debounce
    },
    [sendTypingStatus]
  );

  // Handle typing detection
  const handleTyping = useCallback(() => {
    if (!isTyping) {
      setIsTyping(true);
      debouncedTypingStatus(true);
    }

    // Clear existing timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    // Set new timeout to stop typing after 3 seconds of inactivity
    typingTimeoutRef.current = setTimeout(() => {
      setIsTyping(false);
      debouncedTypingStatus(false);
    }, 3000);
  }, [isTyping, debouncedTypingStatus]);

  // Stop typing immediately
  const stopTyping = useCallback(() => {
    if (isTyping) {
      setIsTyping(false);
      sendTypingStatus(false);
    }
    
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
  }, [isTyping, sendTypingStatus]);

  // Listen for typing status updates from other users
  useEffect(() => {
    if (!conversationId) return;

    const channelId = `typing-${conversationId}-${Math.random().toString(36).substring(2, 15)}`;
    const channel = supabase
      .channel(channelId)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'typing_status',
        filter: `conversation_id=eq.${conversationId}`
      }, async (payload) => {
        const { user_id, is_typing, updated_at } = payload.new as any;
        
        // Don't show our own typing status
        if (user_id === user?.id) return;

        // Get user name
        try {
          const { data: userData } = await supabase
            .from('users')
            .select('name')
            .eq('id', user_id)
            .single();

          const userName = userData?.name || 'Unknown User';

          if (is_typing) {
            // Add or update typing user
            setTypingUsers(prev => {
              const filtered = prev.filter(u => u.user_id !== user_id);
              return [...filtered, {
                user_id,
                user_name: userName,
                is_typing: true,
                updated_at
              }];
            });
          } else {
            // Remove typing user
            setTypingUsers(prev => prev.filter(u => u.user_id !== user_id));
          }
        } catch (error) {
          console.error('Error fetching user data for typing indicator:', error);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, user?.id]);

  // Clean up old typing status entries periodically
  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      setTypingUsers(prev => {
        const now = new Date();
        return prev.filter(user => {
          const updatedAt = new Date(user.updated_at);
          const diffInSeconds = (now.getTime() - updatedAt.getTime()) / 1000;
          return diffInSeconds < 10; // Remove entries older than 10 seconds
        });
      });
    }, 5000); // Check every 5 seconds

    return () => clearInterval(cleanupInterval);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isTyping) {
        sendTypingStatus(false);
      }
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [isTyping, sendTypingStatus]);

  // Get other users who are typing (excluding current user)
  const otherTypingUsers = typingUsers.filter(u => u.user_id !== user?.id);

  return {
    isTyping,
    otherTypingUsers,
    handleTyping,
    stopTyping
  };
}
