"use client";

import { MarketplaceChatLayout } from '@/components/messages/MarketplaceChatLayout';
import { useAuth } from '@/hooks/use-supabase-auth';
import { useState, useEffect, useMemo } from 'react';
import type { User } from '@/types';
import { Skeleton } from '@/components/ui/skeleton';

const MarketplaceChatLoading = () => (
    <div className="p-4 space-y-4">
        <div className="flex items-center gap-4">
            <Skeleton className="h-12 w-12 rounded-full" />
            <div className="space-y-2 flex-1">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
            </div>
        </div>
        <div className="flex items-center gap-4">
            <Skeleton className="h-12 w-12 rounded-full" />
            <div className="space-y-2 flex-1">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
            </div>
        </div>
    </div>
);

// Client component to handle the interactive parts
export function MarketplaceChatPageClient({ chatId }: { chatId: string }) {
    const { user, profile } = useAuth();
    const [loading, setLoading] = useState(true);

    const currentUser = useMemo(() => user ? {
        id: user.id,
        uid: user.id,
        name: profile?.name || user.user_metadata?.name || user.email?.split('@')[0] || 'Anonymous',
        avatar_url: profile?.avatar_url || user.user_metadata?.avatar_url || `https://placehold.co/100x100.png`,
    } as User : null, [user, profile]);

    // Simulate loading for a moment
    useEffect(() => {
        const timer = setTimeout(() => setLoading(false), 500);
        return () => clearTimeout(timer);
    }, []);

    if (loading) {
        return <MarketplaceChatLoading />;
    }

    if (!currentUser) {
         return (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-4 text-center bg-gray-50 dark:bg-gray-900/50 rounded-lg">
                <h3 className="text-xl font-semibold text-foreground mb-1">
                    Please log in
                </h3>
                <p className="mb-4 max-w-sm">
                    You need to be logged in to view your marketplace chats.
                </p>
            </div>
        );
    }

    return (
        <div className="h-[calc(100vh_-_4rem)] lg:h-full lg:pt-0 pt-16">
            <MarketplaceChatLayout selectedChatId={chatId} />
        </div>
    );
}
