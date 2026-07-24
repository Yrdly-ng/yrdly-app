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
                // Check if VAPID key is available
                if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
                    // Fail silently if VAPID keys aren't configured yet
                    return;
                }

                // Request notification permission if not already granted
                if (permission === 'default') {
                    const newPermission = await Notification.requestPermission();
                    setPermission(newPermission);

                    if (newPermission !== 'granted') {
                        toast({
                            title: "Permission Required",
                            description: "Please enable notifications to receive updates.",
                        });
                        return;
                    }
                }

                if (permission !== 'granted') {
                    return;
                }

                // Register service worker
                const registration = await navigator.serviceWorker.ready;
                
                // Convert VAPID key from base64url to Uint8Array
                const applicationServerKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
                
                // Convert base64url to base64
                const base64 = applicationServerKey
                    .replace(/-/g, '+')
                    .replace(/_/g, '/');
                
                // Add padding if needed
                const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
                
                // Convert to Uint8Array
                const binaryString = atob(padded);
                const keyArray = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    keyArray[i] = binaryString.charCodeAt(i);
                }
                
                // Subscribe to push notifications
                const subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: keyArray
                });

                // Send subscription to Supabase
                const { error } = await supabase
                    .from('push_subscriptions')
                    .upsert({
                        user_id: user.id,
                        subscription: subscription,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    });

                if (error) {
                    // Error saving push subscription
                } else {
                }

            } catch (error) {
                toast({
                    variant: "destructive",
                    title: "Push Notifications",
                    description: "Failed to enable push notifications. Please try again.",
                });
            }
        };

        setupPushNotifications();
    }, [user, isSupported, permission, toast]);

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
