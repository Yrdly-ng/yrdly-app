"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-supabase-auth';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ArrowLeft, Loader2, UserX, ShieldCheck } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

interface BlockedUser {
  id: string;
  name: string;
  username: string | null;
  avatar_url: string | null;
}

export default function BlockedUsersPage() {
  const router = useRouter();
  const { profile, updateProfile } = useAuth();
  const { toast } = useToast();
  
  const [blockedList, setBlockedList] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);

  useEffect(() => {
    async function fetchBlockedUsers() {
      const blockedIds: string[] = profile?.blocked_users || [];
      if (blockedIds.length === 0) {
        setBlockedList([]);
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from('users')
          .select('id, name, username, avatar_url')
          .in('id', blockedIds);

        if (error) throw error;
        setBlockedList(data || []);
      } catch (err: any) {
        console.error('Error fetching blocked users:', err);
        toast({
          title: "Error",
          description: "Failed to load blocked users.",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    }

    fetchBlockedUsers();
  }, [profile?.blocked_users, toast]);

  const handleUnblock = async (blockedUserId: string) => {
    setUnblockingId(blockedUserId);
    const updated = (profile?.blocked_users || []).filter((id: string) => id !== blockedUserId);
    try {
      await updateProfile({ blocked_users: updated });
      setBlockedList(prev => prev.filter(u => u.id !== blockedUserId));
      toast({
        title: "User Unblocked",
        description: "The user has been removed from your blocked list.",
      });
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to unblock user.",
        variant: "destructive",
      });
    } finally {
      setUnblockingId(null);
    }
  };

  return (
    <div className="container max-w-2xl py-6 space-y-6 min-h-[100dvh] bg-[var(--yrdly-dark)] text-[var(--yrdly-text-primary)] font-yrdly-body">
      <div className="flex items-center space-x-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-2xl font-bold font-yrdly-display tracking-tight text-[var(--yrdly-text-primary)]">Blocked Users</h1>
      </div>

      <Card className="border border-[var(--yrdly-glass-border)] bg-[var(--yrdly-glass-bg)] backdrop-blur-xl shadow-lg font-yrdly-body">
        <CardHeader>
          <CardTitle className="text-lg font-yrdly-display font-medium flex items-center gap-2 text-[var(--yrdly-text-primary)]">
            <UserX className="h-5 w-5 text-muted-foreground" />
            Manage Blocked Accounts
          </CardTitle>
          <CardDescription>
            Blocked users cannot message you, see your posts, or find your profile in local search results.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="flex items-center justify-between py-2">
                  <div className="flex items-center space-x-3">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div className="space-y-1">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-20" />
                    </div>
                  </div>
                  <Skeleton className="h-9 w-20" />
                </div>
              ))}
            </div>
          ) : blockedList.length === 0 ? (
            <div className="text-center py-8 space-y-3">
              <div className="inline-flex p-3 rounded-full bg-primary/10 text-primary">
                <ShieldCheck className="h-8 w-8" />
              </div>
              <p className="text-muted-foreground text-sm">You haven&apos;t blocked any users.</p>
            </div>
          ) : (
            <div className="divide-y">
              {blockedList.map(user => {
                const initials = user.name ? user.name.charAt(0).toUpperCase() : '?';
                const isUnblocking = unblockingId === user.id;

                return (
                  <div key={user.id} className="flex items-center justify-between py-3">
                    <div className="flex items-center space-x-3">
                      <Avatar>
                        <AvatarImage src={user.avatar_url || undefined} alt={user.name} />
                        <AvatarFallback>{initials}</AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium text-sm leading-none">{user.name}</p>
                        {user.username && (
                          <p className="text-xs text-muted-foreground mt-1">@{user.username}</p>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleUnblock(user.id)}
                      disabled={isUnblocking}
                    >
                      {isUnblocking ? <Loader2 className="h-4 w-4 animate-spin" /> : "Unblock"}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
