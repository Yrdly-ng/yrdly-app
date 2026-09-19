"use client";

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { useAuth } from '@/hooks/use-supabase-auth';
import { useToast } from '@/hooks/use-toast';
import { Card, CardHeader, CardContent, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { PushNotificationService } from '@/lib/push-notification-service';
import type { NotificationSettings } from "../../../../types";

export default function NotificationSettingsPage() {
    const { user } = useAuth();
    const { toast } = useToast();
    const [settings, setSettings] = useState<NotificationSettings | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user) return;

        // Set up real-time subscription for user settings
        const channel = supabase
            .channel(`user_settings_${user.id}`)
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'users',
                filter: `id=eq.${user.id}`
            }, (payload) => {
                const userData = payload.new;
                if (userData && userData.notification_settings) {
                    setSettings(userData.notification_settings);
                } else {
                    // Initialize with default settings if none exist
                    setSettings({
                        friendRequests: true,
                        messages: true,
                        postUpdates: true,
                        comments: true,
                        postLikes: true,
                        eventInvites: true,
                    });
                }
                setLoading(false);
            })
            .subscribe();

        // Also fetch settings initially
        const fetchSettings = async () => {
            const { data, error } = await supabase
                .from('users')
                .select('notification_settings')
                .eq('id', user.id)
                .single();
            
            if (data && data.notification_settings) {
                setSettings(data.notification_settings);
            } else {
                // Initialize with default settings if none exist
                setSettings({
                    friendRequests: true,
                    messages: true,
                    postUpdates: true,
                    comments: true,
                    postLikes: true,
                    eventInvites: true,
                });
            }
            setLoading(false);
        };
        
        fetchSettings();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [user]);

    const handleSettingChange = async (key: keyof NotificationSettings, value: boolean) => {
        if (!user || !settings) return;

        const newSettings = { ...settings, [key]: value };
        setSettings(newSettings);

        try {
            const { error } = await supabase
                .from('users')
                .update({ notification_settings: newSettings })
                .eq('id', user.id);
            
            if (error) throw error;
            toast({ title: 'Settings updated successfully.' });
        } catch {
            toast({ variant: 'destructive', title: 'Error', description: 'Failed to update settings.' });
        }
    };

    if (loading) {
        return (
            <div className="pt-16 pb-20 px-4 max-w-2xl mx-auto space-y-4 font-yrdly-body text-foreground">
                <Link href="/settings">
                    <Button variant="ghost" className="gap-2 text-primary font-bold">
                        <ArrowLeft className="h-4 w-4" />
                        Back to Settings
                    </Button>
                </Link>
                
                <Card className="border border-[var(--yrdly-glass-border)] bg-[var(--yrdly-glass-bg)] backdrop-blur-xl">
                    <CardHeader>
                        <CardTitle className="font-yrdly-display text-foreground">Notification Settings</CardTitle>
                        <CardDescription className="text-[var(--yrdly-label)]">Manage how you receive notifications.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        {[...Array(5)].map((_, i) => (
                            <div key={i} className="flex items-center justify-between">
                                <Skeleton className="h-5 w-48" />
                                <Skeleton className="h-6 w-12" />
                            </div>
                        ))}
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="pt-16 pb-20 px-4 max-w-2xl mx-auto space-y-4 font-yrdly-body text-foreground">
            <Link href="/settings">
                <Button variant="ghost" className="gap-2 text-primary font-bold">
                    <ArrowLeft className="h-4 w-4" />
                    Back to Settings
                </Button>
            </Link>
            
            <Card className="border border-[var(--yrdly-glass-border)] bg-[var(--yrdly-glass-bg)] backdrop-blur-xl shadow-lg">
                <CardHeader>
                    <CardTitle className="font-yrdly-display text-foreground text-xl">Notification Settings</CardTitle>
                    <CardDescription className="text-[var(--yrdly-label)]">Manage how you receive notifications from Yrdly.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="flex items-center justify-between">
                        <Label htmlFor="friendRequests" className="flex flex-col space-y-1">
                            <span className="text-foreground font-medium">Friend Requests</span>
                            <span className="text-sm text-[var(--yrdly-label)]">Notify me about new friend requests and acceptances.</span>
                        </Label>
                        <Switch
                            id="friendRequests"
                            checked={settings?.friendRequests ?? true}
                            onCheckedChange={(value) => handleSettingChange('friendRequests', value)}
                        />
                    </div>
                    <div className="flex items-center justify-between">
                        <Label htmlFor="messages" className="flex flex-col space-y-1">
                            <span className="text-foreground font-medium">New Messages</span>
                            <span className="text-sm text-[var(--yrdly-label)]">Notify me when I receive a new message.</span>
                        </Label>
                        <Switch
                            id="messages"
                            checked={settings?.messages ?? true}
                            onCheckedChange={(value) => handleSettingChange('messages', value)}
                        />
                    </div>
                    <div className="flex items-center justify-between">
                        <Label htmlFor="postUpdates" className="flex flex-col space-y-1">
                            <span className="text-foreground font-medium">New Posts</span>
                            <span className="text-sm text-[var(--yrdly-label)]">Notify me about new posts in my neighborhood.</span>
                        </Label>
                        <Switch
                            id="postUpdates"
                            checked={settings?.postUpdates ?? true}
                            onCheckedChange={(value) => handleSettingChange('postUpdates', value)}
                        />
                    </div>
                    <div className="flex items-center justify-between">
                        <Label htmlFor="comments" className="flex flex-col space-y-1">
                            <span className="text-foreground font-medium">Post Comments & Replies</span>
                            <span className="text-sm text-[var(--yrdly-label)]">Notify me when someone comments on my posts.</span>
                        </Label>
                        <Switch
                            id="comments"
                            checked={settings?.comments ?? true}
                            onCheckedChange={(value) => handleSettingChange('comments', value)}
                        />
                    </div>
                    <div className="flex items-center justify-between">
                        <Label htmlFor="postLikes" className="flex flex-col space-y-1">
                            <span className="text-foreground font-medium">Post Likes</span>
                            <span className="text-sm text-[var(--yrdly-label)]">Notify me when someone likes my post.</span>
                        </Label>
                        <Switch
                            id="postLikes"
                            checked={settings?.postLikes ?? true}
                            onCheckedChange={(value) => handleSettingChange('postLikes', value)}
                        />
                    </div>
                    <div className="flex items-center justify-between">
                        <Label htmlFor="eventInvites" className="flex flex-col space-y-1">
                            <span className="text-foreground font-medium">Event Invitations</span>
                            <span className="text-sm text-[var(--yrdly-label)]">Notify me when I&apos;m invited to an event.</span>
                        </Label>
                        <Switch
                            id="eventInvites"
                            checked={settings?.eventInvites ?? true}
                            onCheckedChange={(value) => handleSettingChange('eventInvites', value)}
                        />
                    </div>
                </CardContent>
            </Card>

            {/* Test Push Notifications */}
            <Card className="border border-[var(--yrdly-glass-border)] bg-[var(--yrdly-glass-bg)] backdrop-blur-xl shadow-lg">
                <CardHeader>
                    <CardTitle className="font-yrdly-display text-foreground text-xl">Test Push Notifications</CardTitle>
                    <CardDescription className="text-[var(--yrdly-label)]">
                        Test if push notifications are working properly.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Button 
                        onClick={async () => {
                            if (!user) return;
                            
                            try {
                                if (typeof window !== 'undefined' && 'Notification' in window) {
                                    if (Notification.permission === 'default') {
                                        const perm = await Notification.requestPermission();
                                        if (perm !== 'granted') {
                                            toast({
                                                variant: "destructive",
                                                title: "Permission Denied",
                                                description: "Please enable notifications in your browser settings to receive test notifications.",
                                            });
                                            return;
                                        }
                                    } else if (Notification.permission === 'denied') {
                                        toast({
                                            variant: "destructive",
                                            title: "Permission Denied",
                                            description: "Notifications are blocked in your browser settings. Please unblock them to test.",
                                        });
                                        return;
                                    }
                                }

                                const success = await PushNotificationService.testNotification(user.id);
                                if (success) {
                                    toast({
                                        title: "Test Notification Sent 🔔",
                                        description: "A test notification was delivered to your device.",
                                    });
                                } else {
                                    toast({
                                        variant: "destructive",
                                        title: "Test Failed",
                                        description: "Could not send test notification. Please try again.",
                                    });
                                }
                            } catch (error) {
                                console.error('Error testing push notification:', error);
                                toast({
                                    variant: "destructive",
                                    title: "Test Failed",
                                    description: "An error occurred while testing push notifications.",
                                });
                            }
                        }}
                        variant="outline"
                        className="border-[var(--yrdly-glass-border)] bg-background/50 text-foreground font-bold font-yrdly-body"
                    >
                        Send Test Notification
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}

