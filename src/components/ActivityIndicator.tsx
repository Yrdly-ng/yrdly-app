"use client";

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { timeAgo } from '@/lib/utils';
import Image from 'next/image';
import { cn } from '@/lib/utils';

interface ActivityIndicatorProps {
  userId: string;
  showText?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function ActivityIndicator({ 
  userId, 
  showText = false, 
  size = 'md',
  className 
}: ActivityIndicatorProps) {
  const [status, setStatus] = useState({
    is_online: false,
    last_seen: null as string | null
  });

  const sizeClasses = {
    sm: 'w-2 h-2',
    md: 'w-3 h-3',
    lg: 'w-4 h-4'
  };

  const textSizeClasses = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-base'
  };

  useEffect(() => {
    if (!userId) return;

    // Fetch initial status
    const fetchUserStatus = async () => {
      try {
        const { data, error } = await supabase
          .from('users')
          .select('is_online, last_seen')
          .eq('id', userId)
          .maybeSingle(); // Use maybeSingle() to handle cases where user doesn't exist

        if (error) {
          // Only log non-404 errors (user not found is expected for some users)
          if (error.code !== 'PGRST116') {
            console.error('Error fetching user status:', error);
          }
          return;
        }

        // If user exists, update status; otherwise use defaults
        if (data) {
          setStatus({
            is_online: data.is_online || false,
            last_seen: data.last_seen
          });
        } else {
          // User doesn't exist in users table, use default offline status
          setStatus({
            is_online: false,
            last_seen: null
          });
        }
      } catch (error) {
        // Silently handle errors - user might not exist in users table
        setStatus({
          is_online: false,
          last_seen: null
        });
      }
    };

    fetchUserStatus();

    // Subscribe to real-time status updates
    const channel = supabase
      .channel(`user-status-${userId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'users',
        filter: `id=eq.${userId}`
      }, (payload) => {
        const updatedUser = payload.new as any;
        setStatus({
          is_online: updatedUser.is_online || false,
          last_seen: updatedUser.last_seen
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const getStatusText = () => {
    if (status.is_online) {
      return 'Online';
    }
    
    if (status.last_seen) {
      const lastSeenDate = new Date(status.last_seen);
      const now = new Date();
      const diffInMinutes = Math.floor((now.getTime() - lastSeenDate.getTime()) / (1000 * 60));
      
      if (diffInMinutes < 1) return 'Just now';
      if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
      
      const diffInHours = Math.floor(diffInMinutes / 60);
      if (diffInHours < 24) return `${diffInHours}h ago`;
      
      const diffInDays = Math.floor(diffInHours / 24);
      if (diffInDays < 7) return `${diffInDays}d ago`;
      
      return 'Last seen recently';
    }
    
    return 'Offline';
  };

  const getStatusColor = () => {
    if (status.is_online) return 'bg-green-500';
    
    if (status.last_seen) {
      const lastSeenDate = new Date(status.last_seen);
      const now = new Date();
      const diffInMinutes = Math.floor((now.getTime() - lastSeenDate.getTime()) / (1000 * 60));
      
      // Yellow for recently active (within 30 minutes)
      if (diffInMinutes < 30) return 'bg-yellow-500';
    }
    
    return 'bg-gray-400';
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {/* Status Dot */}
      <div 
        className={cn(
          "rounded-full border-2 border-border dark:border-gray-800",
          sizeClasses[size],
          getStatusColor()
        )}
      />

      {/* Status Text */}
      {showText && (
        <span className={cn(
          "text-muted-foreground",
          textSizeClasses[size]
        )}>
          {getStatusText()}
        </span>
      )}
    </div>
  );
}

// Helper component for avatar with activity indicator
interface AvatarWithActivityProps {
  userId: string;
  avatarUrl?: string;
  name: string;
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
  className?: string;
}

export function AvatarWithActivity({ 
  userId, 
  avatarUrl, 
  name, 
  size = 'md',
  showText = false,
  className 
}: AvatarWithActivityProps) {
  const avatarSizeClasses = {
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-12 h-12'
  };

  const indicatorSizeClasses = {
    sm: 'w-2 h-2 -bottom-0.5 -right-0.5',
    md: 'w-3 h-3 -bottom-1 -right-1',
    lg: 'w-4 h-4 -bottom-1 -right-1'
  };

  return (
    <div className={cn("relative", className)}>
      <div className={cn("rounded-full overflow-hidden", avatarSizeClasses[size])}>
        <Image 
          src={avatarUrl || "/placeholder.svg"} 
          alt={name}
          width={64}
          height={64}
          className="w-full h-full object-cover"
        />
      </div>
      
      <ActivityIndicator 
        userId={userId} 
        size={size === 'lg' ? 'md' : 'sm'}
        className={cn("absolute", indicatorSizeClasses[size])}
      />
      
      {showText && (
        <div className="mt-1">
          <ActivityIndicator 
            userId={userId} 
            showText={true}
            size="sm"
          />
        </div>
      )}
    </div>
  );
}
