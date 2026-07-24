import React from 'react';
import { cn } from '@/lib/utils';

interface OnlineIndicatorProps {
  isOnline: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  showLabel?: boolean;
}

export function OnlineIndicator({ 
  isOnline, 
  size = 'md', 
  className,
  showLabel = false 
}: OnlineIndicatorProps) {
  // Don't render anything if user is offline
  if (!isOnline) return null;
  
  const sizeClasses = {
    sm: 'w-2 h-2',
    md: 'w-3 h-3',
    lg: 'w-4 h-4'
  };

  const labelSizeClasses = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-base'
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        className={cn(
          "rounded-full border-2 border-background bg-green-500",
          sizeClasses[size]
        )}
      />
      {showLabel && (
        <span className={cn(
          "font-medium text-green-600 dark:text-green-400",
          labelSizeClasses[size]
        )}>
          Online
        </span>
      )}
    </div>
  );
}

// Compact version for avatars
export function AvatarOnlineIndicator({ 
  isOnline, 
  className 
}: { 
  isOnline: boolean; 
  className?: string;
}) {
  // Don't render anything if user is offline
  if (!isOnline) return null;
  
  return (
    <div
      className={cn(
        "absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background bg-green-500",
        className
      )}
    />
  );
}
