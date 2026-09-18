"use client";

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/use-supabase-auth';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';

export function PushNotificationManager() {
    const { user } = useAuth();
    const { toast } = useToast();
    const [isSupported, setIsSupported] = useState(false);
    const [permission, setPermission] = useState<NotificationPermission>('default');

    useEffect(() => {
        // Check if push notifications are supported
        if ('Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window) {
            setIsSupported(true);
            setPermission(Notification.permission);
        }
    }, []);

    useEffect(() => {
        if (!user || !isSupported) return;

        const setupPushNotifications = async () => {
            try {
                if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) return;

                let currentPermission = Notification.permission;

                // Request permission if default, but do not spam toasts if dismissed/denied
                if (currentPermission === 'default') {
                    try {
                        currentPermission = await Notification.requestPermission();
                        setPermission(currentPermission);
                    } catch {
                        return;
                    }
                }

                if (currentPermission !== 'granted') {
                    return;
                }

                // Register service worker & push subscription
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
                // Silently handle error on app boot to prevent annoying toasts
                console.error("Push notification setup error:", error);
            }
        };

        setupPushNotifications();
    }, [user, isSupported]);

    // Handle notification clicks
    useEffect(() => {
        if (!isSupported) return;

        const handleNotificationClick = (event: any) => {
            event.notification.close();
            
            // Handle different notification types
            const data = event.notification.data;
            if (data && data.url) {
                window.location.href = data.url;
            }
        };

        // Listen for notification clicks
        navigator.serviceWorker.addEventListener('message', (event) => {
            if (event.data && event.data.type === 'NOTIFICATION_CLICK') {
                handleNotificationClick(event.data);
            }
        });

        return () => {
            navigator.serviceWorker.removeEventListener('message', handleNotificationClick);
        };
    }, [isSupported]);

    return null; // This component does not render anything
}
