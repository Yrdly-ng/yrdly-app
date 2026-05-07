"use client";

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from './use-supabase-auth';
import { useToast } from './use-toast';
import { NotificationService, NotificationData, NotificationType } from '@/lib/notification-service';

export interface Notification {
    id: string;
    user_id: string;
    type: NotificationType;
    sender_id?: string;
    related_id?: string;
    related_type?: string;
    title: string;
    message: string;
    data?: Record<string, any>;
    is_read: boolean;
    read_at?: string;
    created_at: string;
    updated_at: string;
}

export const useNotifications = () => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [loading, setLoading] = useState(true);

    // Fetch notifications from the service
    const fetchNotifications = useCallback(async () => {
        if (!user) {
            setNotifications([]);
            setUnreadCount(0);
            setLoading(false);
            return;
        }

        try {
            const [notificationsData, unreadCountData] = await Promise.all([
                NotificationService.getNotifications(user.id),
                NotificationService.getUnreadCount(user.id)
            ]);

            setNotifications(notificationsData);
            setUnreadCount(unreadCountData);
        } catch (error) {
            console.error('Error fetching notifications:', error);
            toast({
                variant: 'destructive',
                title: 'Error',
                description: 'Failed to load notifications'
            });
        } finally {
            setLoading(false);
        }
    }, [user, toast]);

    useEffect(() => {
        if (!user) {
            setNotifications([]);
            setUnreadCount(0);
            setLoading(false);
            return;
        }

        // Set up real-time subscription for notifications
        const channel = supabase
            .channel(`notifications_${user.id}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'notifications',
                filter: `user_id=eq.${user.id}`
            }, (payload) => {
                console.log('Real-time notification received:', payload);
                
                if (payload.eventType === 'INSERT' && payload.new) {
                    const newNotification = payload.new as Notification;
                    console.log('New notification:', newNotification);
                    
                    setNotifications(prev => {
                        const existing = prev.filter(n => n.id !== newNotification.id);
                        const updated = [newNotification, ...existing].sort((a, b) => 
                            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
                        );
                        
                        // Show toast for new notifications
                        if (!newNotification.is_read) {
                            console.log('Showing toast for new notification:', newNotification.title);
                            toast({
                                title: newNotification.title,
                                description: newNotification.message,
                            });
                        }
                        
                        return updated;
                    });
                    
                    if (!newNotification.is_read) {
                        setUnreadCount(prev => prev + 1);
                    }
                } else if (payload.eventType === 'UPDATE' && payload.new) {
                    const updatedNotification = payload.new as Notification;
                    // Use functional updater so we read fresh prev state, not stale closure
                    setNotifications(prev => {
                        const old = prev.find(n => n.id === updatedNotification.id);
                        if (old && !old.is_read && updatedNotification.is_read) {
                            setUnreadCount(c => Math.max(0, c - 1));
                        }
                        return prev.map(n => n.id === updatedNotification.id ? updatedNotification : n);
                    });
                } else if (payload.eventType === 'DELETE') {
                    const deletedId = payload.old.id;
                    setNotifications(prev => {
                        const deleted = prev.find(n => n.id === deletedId);
                        const updated = prev.filter(n => n.id !== deletedId);
                        
                        if (deleted && !deleted.is_read) {
                            setUnreadCount(prev => Math.max(0, prev - 1));
                        }
                        
                        return updated;
                    });
                }
            })
            .subscribe();

        // Fetch initial notifications
        fetchNotifications();

        return () => {
            supabase.removeChannel(channel);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id, fetchNotifications, toast]);

    const markAsRead = useCallback(async (notificationId: string) => {
        if (!user) return;
        
        try {
            await NotificationService.markAsRead(notificationId, user.id);
            
            // Update local state immediately for better UX
            setNotifications(prev => 
                prev.map(n => 
                    n.id === notificationId 
                        ? { ...n, is_read: true, read_at: new Date().toISOString() }
                        : n
                )
            );
            
            setUnreadCount(prev => Math.max(0, prev - 1));
        } catch (error) {
            console.error('Error marking notification as read:', error);
            toast({
                variant: 'destructive',
                title: 'Error',
                description: 'Failed to mark notification as read'
            });
        }
    }, [user, toast]);

    const markAllAsRead = useCallback(async () => {
        if (!user) return;
        
        try {
            await NotificationService.markAllAsRead(user.id);
            
            // Update local state immediately
            setNotifications(prev => 
                prev.map(n => ({ ...n, is_read: true, read_at: new Date().toISOString() }))
            );
            
            setUnreadCount(0);
            
            toast({
                title: 'Success',
                description: 'All notifications marked as read'
            });
        } catch (error) {
            console.error('Error marking all notifications as read:', error);
            toast({
                variant: 'destructive',
                title: 'Error',
                description: 'Failed to mark all notifications as read'
            });
        }
    }, [user, toast]);

    const clearAllNotifications = useCallback(async () => {
        if (!user) return;
        
        try {
            await NotificationService.clearAllNotifications(user.id);
            
            // Update local state immediately
            setNotifications([]);
            setUnreadCount(0);
            
            toast({
                title: 'Success',
                description: 'All notifications cleared'
            });
        } catch (error) {
            console.error('Error clearing all notifications:', error);
            toast({
                variant: 'destructive',
                title: 'Error',
                description: 'Failed to clear all notifications'
            });
        }
    }, [user, toast]);

    const deleteNotification = useCallback(async (notificationId: string) => {
        if (!user) return;
        
        try {
            await NotificationService.deleteNotification(notificationId, user.id);
            
            // Update local state immediately
            setNotifications(prev => {
                const deleted = prev.find(n => n.id === notificationId);
                const updated = prev.filter(n => n.id !== notificationId);
                
                if (deleted && !deleted.is_read) {
                    setUnreadCount(prev => Math.max(0, prev - 1));
                }
                
                return updated;
            });
        } catch (error) {
            console.error('Error deleting notification:', error);
            toast({
                variant: 'destructive',
                title: 'Error',
                description: 'Failed to delete notification'
            });
        }
    }, [user, toast]);

    const refreshNotifications = useCallback(() => {
        fetchNotifications();
    }, [fetchNotifications]);

    return { 
        notifications, 
        unreadCount, 
        loading, 
        markAsRead, 
        markAllAsRead, 
        clearAllNotifications,
        deleteNotification,
        refreshNotifications
    };
};