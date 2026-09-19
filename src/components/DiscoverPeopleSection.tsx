'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCommunityConnections, CommunityFilterTab } from '@/hooks/use-community-connections';
import { DiscoverUserCard } from '@/components/DiscoverUserCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Compass } from 'lucide-react';
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
  const { discoverUsers, loading } = useCommunityConnections(activeTab);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent className="flex items-center gap-4 overflow-x-auto pb-2 scrollbar-hide">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-44 w-[200px] rounded-2xl flex-shrink-0" />
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
          <div className="flex items-center gap-4 overflow-x-auto pb-2 scrollbar-hide">
            {discoverUsers.slice(0, 10).map((person) => (
              <DiscoverUserCard
                key={person.id}
                user={person}
                context={activeTab === 'neighbors' ? 'neighbor' : activeTab === 'sellers' ? 'seller' : 'mutual'}
                mutualCount={1}
                onPress={() => router.push(`/profile/${person.id}`)}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
