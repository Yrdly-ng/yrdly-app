import React from 'react';
import { Users } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { cn } from '../lib/utils';

export interface AttendeeUser {
  id?: string;
  name?: string;
  avatar_url?: string;
}

interface AttendeeAvatarsProps {
  attendees?: (AttendeeUser | string)[];
  totalCount?: number;
  maxVisible?: number;
  className?: string;
  showIcon?: boolean;
}

export function AttendeeAvatars({
  attendees = [],
  totalCount,
  maxVisible = 4,
  className,
  showIcon = true,
}: AttendeeAvatarsProps) {
  const normalizedAttendees: AttendeeUser[] = attendees.map((item, idx) => {
    if (typeof item === 'string') {
      return { id: item };
    }
    return item;
  });

  const count = totalCount !== undefined ? totalCount : normalizedAttendees.length;

  if (count === 0 && (!normalizedAttendees || normalizedAttendees.length === 0)) {
    return null;
  }

  const visibleAttendees = normalizedAttendees.slice(0, maxVisible);
  const remainingCount = count - visibleAttendees.length;

  return (
    <div className={cn("inline-flex items-center gap-1.5", className)}>
      {showIcon && (
        <Users className="w-4 h-4 text-white/70 flex-shrink-0" />
      )}

      {visibleAttendees.length > 0 && (
        <div className="flex -space-x-2 overflow-hidden items-center">
          {visibleAttendees.map((user, idx) => {
            const initial = user?.name ? user.name.charAt(0).toUpperCase() : '?';
            return (
              <Avatar
                key={user?.id || idx}
                className="w-6 h-6 border-2 border-[var(--c-card,#000)] ring-1 ring-black/20 flex-shrink-0"
              >
                <AvatarImage src={user?.avatar_url || ''} alt={user?.name || 'Attendee'} />
                <AvatarFallback className="bg-primary/20 text-primary font-bold text-[0.6rem]">
                  {initial}
                </AvatarFallback>
              </Avatar>
            );
          })}
        </div>
      )}

      {remainingCount > 0 && (
        <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-full text-xs font-bold font-sans text-white/80 bg-white/10 border border-white/10">
          +{remainingCount}
        </span>
      )}
    </div>
  );
}
