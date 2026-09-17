'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCommunityConnections, CommunityFilterTab } from '@/hooks/use-community-connections';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { UserPlus, Users, Loader2, Compass } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

const FILTER_TABS: { key: CommunityFilterTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'neighbors', label: 'Neighbors' },
  { key: 'mutuals', label: 'Mutuals' },
  { key: 'sellers', label: 'Sellers' },
];

export function DiscoverPeopleSection() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<CommunityFilterTab>('all');
  const { discoverUsers, loading, actionInProgress, followUser } = useCommunityConnections(activeTab);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center space-x-3 p-3 border rounded-lg">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="space-y-1 flex-1">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3">
        <div className="flex items-center justify-between w-full sm:w-auto">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Compass className="h-4 w-4 text-primary" />
            Discover People
          </CardTitle>
          <Button variant="ghost" size="sm" className="sm:hidden text-xs text-primary" onClick={() => router.push('/community')}>
            View All
          </Button>
        </div>

        {/* Filter Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 no-scrollbar">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1 text-xs font-semibold rounded-full transition-all shrink-0 ${
                activeTab === tab.key
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <Button variant="ghost" size="sm" className="hidden sm:flex text-xs text-primary" onClick={() => router.push('/community')}>
          View All
        </Button>
      </CardHeader>

      <CardContent>
        {discoverUsers.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            No suggested connections found for this filter.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {discoverUsers.slice(0, 6).map((person) => {
              const initials = person.name ? person.name.charAt(0).toUpperCase() : '?';
              const isFollowing = actionInProgress[person.id];

              return (
                <div
                  key={person.id}
                  className="flex items-center justify-between p-3 rounded-xl border border-border/50 bg-card hover:bg-muted/30 transition-colors shadow-2xs"
                >
                  <div
                    className="flex items-center space-x-3 min-w-0 cursor-pointer"
                    onClick={() => router.push(`/profile/${person.id}`)}
                  >
                    <Avatar className="h-10 w-10 border border-border/40">
                      <AvatarImage src={person.avatar_url || undefined} alt={person.name} />
                      <AvatarFallback className="bg-primary/10 text-primary font-bold text-xs">{initials}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{person.name}</p>
                      {person.username && (
                        <p className="text-xs text-muted-foreground truncate">@{person.username}</p>
                      )}
                    </div>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 ml-2 rounded-full h-8 text-xs font-semibold border-primary/30 text-primary hover:bg-primary/10"
                    onClick={() => followUser(person.id)}
                    disabled={isFollowing}
                  >
                    {isFollowing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <>
                        <UserPlus className="h-3.5 w-3.5 mr-1" />
                        Follow
                      </>
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
