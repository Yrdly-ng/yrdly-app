"use client";

import { useRouter } from 'next/navigation';
import { useCommunityConnections } from '@/hooks/use-community-connections';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { UserPlus, UserCheck, Users, Loader2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

export function DiscoverPeopleSection() {
  const router = useRouter();
  const { discoverUsers, loading, actionInProgress, followUser } = useCommunityConnections();

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

  if (discoverUsers.length === 0) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          Discover People Nearby
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={() => router.push('/community')}>
          View All
        </Button>
      </CardHeader>
      <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {discoverUsers.slice(0, 6).map((person) => {
          const initials = person.name ? person.name.charAt(0).toUpperCase() : '?';
          const isFollowing = actionInProgress[person.id];

          return (
            <div
              key={person.id}
              className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/40 transition-colors"
            >
              <div
                className="flex items-center space-x-3 min-w-0 cursor-pointer"
                onClick={() => router.push(`/profile/${person.id}`)}
              >
                <Avatar className="h-10 w-10">
                  <AvatarImage src={person.avatar_url || undefined} alt={person.name} />
                  <AvatarFallback>{initials}</AvatarFallback>
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
                className="shrink-0 ml-2"
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
      </CardContent>
    </Card>
  );
}
