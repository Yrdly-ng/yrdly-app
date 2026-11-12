"use client";

import { useRouter } from 'next/navigation';
import { ToastAction } from '@/components/ui/toast';
import { getNotificationDestination } from '@/lib/notifications/notification-routing';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/hooks/use-supabase-auth';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/supabase';
import { Bell, X } from 'lucide-react';
import {
    registerBrowserPush,
    unsubscribeBrowserPushLocally,
    webPushAvailability,
    webPushErrorMessage,
} from '@/lib/notifications/web-push-client';

export function PushNotificationManager() {
    const { user, profile } = useAuth();
    const router = useRouter();
    const { toast } = useToast();
    const [isSupported, setIsSupported] = useState(false);
    const [permission, setPermission] = useState<NotificationPermission>('default');
    const [showBanner, setShowBanner] = useState(true);

    const userId = user?.id;
    const hasProfile = Boolean(profile);
    useEffect(() => {
        const checkPermission = () => {
            const supported = webPushAvailability();
            setIsSupported(supported.ok);
            if ('Notification' in window) setPermission(Notification.permission);
        };
        checkPermission();
        document.addEventListener('visibilitychange', checkPermission);
        return () => document.removeEventListener('visibilitychange', checkPermission);
    }, []);

    const subscribeUser = useCallback(async (requestPermission = false) => {
        if (!userId || !hasProfile)
            return { ok: false, reason: 'unsupported' } as const;
        return registerBrowserPush(userId, requestPermission);
    }, [userId, hasProfile]);

    // Permissions can persist across visits; refresh an existing subscription
    // when a user logs in or the browser's VAPID key has changed.
    useEffect(() => {
        if (!userId || !hasProfile || !isSupported || permission !== 'granted') return;
        void subscribeUser().then((result) => {
            if (!result.ok) console.warn('Browser notification registration:', result.reason);
        });
    }, [userId, hasProfile, isSupported, permission, subscribeUser]);

    // Covers forced auth invalidation and other sign-out paths. Normal logout
    // removes the user's database row before clearing authentication.
    useEffect(() => {
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
            if (event === 'SIGNED_OUT')
                void unsubscribeBrowserPushLocally().catch(() => {});
        });
        return () => subscription.unsubscribe();
    }, []);

    // Real-time listener: capture & display every notification (messages, friend requests, alerts, etc.)
    useEffect(() => {
        if (!user) return;

        const channelId = `realtime_notifications_${user.id}_${Math.random().toString(36).substring(2, 9)}`;
        const channel = supabase
            .channel(channelId)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'notifications',
                    filter: `user_id=eq.${user.id}`,
                },
                async (payload) => {
                    const newNotif = payload.new as any;
                    if (!newNotif) return;

                    const destination = getNotificationDestination(newNotif);
                    const route = `${destination}${destination.includes('?') ? '&' : '?'}notificationId=${encodeURIComponent(newNotif.id)}&recipientId=${encodeURIComponent(user.id)}`;
                    // Open through the same ownership and target checks as a browser push.
                    toast({
                        title: newNotif.title || 'Notification 🔔',
                        description: newNotif.message || '',
                        action: <ToastAction altText="Open notification" onClick={() => router.push(route)}>View</ToastAction>,
                    });

                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [user, toast, router]);

    // Browser permission and subscription happen only after the user taps Enable.
    const handleEnableNotifications = async () => {
        try {
            const result = await subscribeUser(true);
            if ('Notification' in window) setPermission(Notification.permission);
            toast(result.ok ? {
                title: "Notifications Enabled",
                description: "This browser is registered for YRDLY notifications.",
            } : {
                variant: "destructive",
                title: "Notifications couldn't be set up",
                description: webPushErrorMessage(result),
            });
        } catch {
            toast({
                variant: "destructive",
                title: "Notifications couldn't be set up",
                description: "Please try again from Notification Settings.",
            });
        } finally {
            setShowBanner(false);
        }
    };

    // Render interactive prompt banner if permission is default and user profile exists
    if (permission === 'default' && showBanner && isSupported && user && profile) {
        return (
            <div className="fixed top-20 left-4 right-4 md:left-auto md:right-6 md:w-96 z-[100] animate-in fade-in slide-in-from-top-4 duration-300">
                <div className="bg-[var(--c-card)] border border-[#82DB7E]/40 rounded-2xl p-4 shadow-2xl backdrop-blur-xl flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-[#82DB7E]/15 flex items-center justify-center flex-shrink-0 text-[#82DB7E]">
                        <Bell className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-bold text-foreground font-yrdly-display">Turn on Notifications</h4>
                        <p className="text-xs text-[var(--c-text-muted)] mt-0.5 font-yrdly-body">
                            Get real-time alerts when neighbours message you or share updates.
                        </p>
                        <div className="flex items-center gap-2 mt-3">
                            <button
                                type="button"
                                onClick={handleEnableNotifications}
                                className="px-4 py-1.5 rounded-full bg-[#82DB7E] text-black text-xs font-bold hover:opacity-90 transition-opacity active:scale-95"
                            >
                                Enable
                            </button>
                            <button
                                type="button"
                                onClick={() => setShowBanner(false)}
                                className="px-3 py-1.5 rounded-full text-xs text-[var(--c-text-muted)] hover:text-foreground transition-colors"
                            >
                                Not now
                            </button>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => setShowBanner(false)}
                        className="text-[var(--c-text-muted)] hover:text-foreground p-1"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>
        );
    }

    return null;
}
