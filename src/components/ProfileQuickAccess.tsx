'use me';
'use client';

import React from 'react';
import Link from 'next/link';
import { Ticket, Calendar, Store, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ProfileQuickAccessProps {
  onOpenStore?: () => void;
  hasBusiness?: boolean;
}

export function ProfileQuickAccess({ onOpenStore, hasBusiness }: ProfileQuickAccessProps) {
  const items = [
    {
      label: 'My Tickets',
      icon: Ticket,
      href: '/my-tickets',
      color: 'text-emerald-500 bg-emerald-500/10 hover:bg-emerald-500/20',
    },
    {
      label: 'My Events',
      icon: Calendar,
      href: '/my-events',
      color: 'text-blue-500 bg-blue-500/10 hover:bg-blue-500/20',
    },
    {
      label: hasBusiness ? 'My Business' : 'Create Business',
      icon: Store,
      onClick: onOpenStore,
      color: 'text-purple-500 bg-purple-500/10 hover:bg-purple-500/20',
    },
    {
      label: 'My Listings',
      icon: Tag,
      href: '/my-listings',
      color: 'text-amber-500 bg-amber-500/10 hover:bg-amber-500/20',
    },
  ];

  return (
    <div className="bg-card border rounded-xl p-4 my-4 shadow-sm">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        Quick Access
      </h3>
      <div className="grid grid-cols-4 gap-2 sm:gap-4">
        {items.map((item, idx) => {
          const Icon = item.icon;
          const content = (
            <div className="flex flex-col items-center gap-1.5 group cursor-pointer text-center">
              <div
                className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center transition-all duration-200 group-hover:scale-105 ${item.color}`}
              >
                <Icon className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
              <span className="text-xs font-medium text-foreground line-clamp-1 group-hover:text-primary transition-colors">
                {item.label}
              </span>
            </div>
          );

          if (item.href) {
            return (
              <Link key={idx} href={item.href} className="focus:outline-none">
                {content}
              </Link>
            );
          }

          return (
            <button
              key={idx}
              onClick={item.onClick}
              className="focus:outline-none w-full text-left"
              type="button"
            >
              {content}
            </button>
          );
        })}
      </div>
    </div>
  );
}
