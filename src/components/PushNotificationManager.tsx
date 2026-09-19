"use client";

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/use-supabase-auth';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { Bell, X } from 'lucide-react';

export function PushNotificationManager() {
    const { user } = useAuth();
    const { toast } = useToast();
    const [isSupported, setIsSupported] = useState(false);
    const [permission, setPermission] = useState<NotificationPermission>('default');
    const [showBanner, setShowBanner] = useState(true);

    useEffect(() => {
        // Check if push notifications are supported
        if ('Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window) {
            setIsSupported(true);
            setPermission(Notification.permission);
        }
    }, []);

    const subscribeUser = async () => {
        try {
            if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !user) return;

            const registration = await navigator.serviceWorker.ready;
            
            const applicationServerKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
            const base64 = applicationServerKey
                .replace(/-/g, '+')
                .replace(/_/g, '/');
            const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
            
            const binaryString = atob(padded);
            const keyArray = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                keyArray[i] = binaryString.charCodeAt(i);
            }
            
            const subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: keyArray
            });

            await supabase
                .from('push_subscriptions')
                .upsert({
                    user_id: user.id,
                    subscription: subscription,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                });

        } catch (error) {
            console.error("Push notification setup error:", error);
        }
    };

    // Auto-subscribe if permission is already granted
    useEffect(() => {
        if (!user || !isSupported) return;
        if (permission === 'granted') {
            subscribeUser();
        }
    }, [user, isSupported, permission]);

    // Real-time listener: capture & display every notification (messages, friend requests, alerts, etc.)
    useEffect(() => {
        if (!user) return;

        const channelId = `realtime_notifications_${user.id}`;
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

                    // 1. Show in-app Toast notification
                    toast({
                        title: newNotif.title || 'Notification 🔔',
                        description: newNotif.message || '',
                    });

                    // 2. Deliver Native OS / Device Push Notification
                    if ('Notification' in window && Notification.permission === 'granted') {
                        try {
                            const url = newNotif.data?.url || '/notifications';
                            const title = newNotif.title || 'Yrdly';
                            const options: any = {
                                body: newNotif.message || '',
                                icon: '/icon-192x192.png',
                                badge: '/icon-192x192.png',
                                data: { url, ...newNotif.data },
                            };

                            if ('serviceWorker' in navigator) {
                                const reg = await navigator.serviceWorker.ready;
                                if (reg && reg.showNotification) {
                                    await reg.showNotification(title, options);
                                    return;
                                }
                            }
                            new Notification(title, options);
                        } catch (err) {
                            console.error('Real-time native push error:', err);
                        }
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [user, toast]);

    // Handle user tapping Enable Notifications button
    const handleEnableNotifications = async () => {
        try {
            const result = await Notification.requestPermission();
            setPermission(result);
            if (result === 'granted') {
                toast({
                    title: "Notifications Enabled",
                    description: "You'll now receive updates and messages in real time.",
                });
                await subscribeUser();
            } else if (result === 'denied') {
                toast({
                    variant: "destructive",
                    title: "Permission Denied",
                    description: "Notifications are blocked. You can enable them in your device browser settings.",
                });
            }
        } catch (err) {
            console.error("Request permission error:", err);
        } finally {
            setShowBanner(false);
        }
    };

    // Handle notification clicks
    useEffect(() => {
        if (!isSupported) return;

        const handleNotificationClick = (event: any) => {
            event.notification.close();
            
            const data = event.notification.data;
            if (data && data.url) {
                window.location.href = data.url;
            }
        };

        navigator.serviceWorker.addEventListener('message', (event) => {
            if (event.data && event.data.type === 'NOTIFICATION_CLICK') {
                handleNotificationClick(event.data);
            }
        });

        return () => {
            navigator.serviceWorker.removeEventListener('message', handleNotificationClick);
        };
    }, [isSupported]);

    // Render interactive prompt banner if permission is default
    if (permission === 'default' && showBanner && isSupported && user) {
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
