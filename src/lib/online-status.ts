import { supabase } from './supabase';

export class OnlineStatusService {
  private static instance: OnlineStatusService;
  private userId: string | null = null;
  private isOnline = false;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private listeners: Map<string, (status: { isOnline: boolean; lastSeen: string | null }) => void> = new Map();

  private constructor() {}

  static getInstance(): OnlineStatusService {
    if (!OnlineStatusService.instance) {
      OnlineStatusService.instance = new OnlineStatusService();
    }
    return OnlineStatusService.instance;
  }

  // Initialize online status tracking for a user
  initialize(userId: string) {
    this.userId = userId;
    
    // Set user as online
    this.setOnlineStatus(true);
    
    // Start heartbeat to keep user online
    this.startHeartbeat();
    
    // Listen for app visibility changes
    document.addEventListener('visibilitychange', this.handleVisibilityChange.bind(this));
    
    // Listen for page unload
    window.addEventListener('beforeunload', this.handlePageUnload.bind(this));
    
    // Listen for online/offline network changes
    window.addEventListener('online', this.handleNetworkOnline.bind(this));
    window.addEventListener('offline', this.handleNetworkOffline.bind(this));
  }

  // Set online status
  private async setOnlineStatus(isOnline: boolean) {
    if (!this.userId) return;

    try {
      const { error } = await supabase
        .from('users')
        .update({ 
          is_online: isOnline,
          last_seen: isOnline ? new Date().toISOString() : new Date().toISOString()
        })
        .eq('id', this.userId);

      if (error) {
        console.error('Error updating online status:', error);
        return;
      }

      this.isOnline = isOnline;
      
      // Notify all listeners
      this.listeners.forEach((callback) => {
        callback({ 
          isOnline, 
          lastSeen: isOnline ? new Date().toISOString() : new Date().toISOString() 
        });
      });
    } catch (error) {
      console.error('Error updating online status:', error);
    }
  }

  // Start heartbeat to keep user online
  private startHeartbeat() {
    // Clear existing heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Update every 30 seconds to keep user online
    this.heartbeatInterval = setInterval(() => {
      if (this.isOnline && this.userId) {
        this.setOnlineStatus(true);
      }
    }, 30000);
  }

  // Stop heartbeat
  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  // Handle visibility change
  private handleVisibilityChange() {
    if (document.hidden) {
      // Page is hidden, set as offline
      this.setOnlineStatus(false);
      this.stopHeartbeat();
    } else {
      // Page is visible, set as online
      this.setOnlineStatus(true);
      this.startHeartbeat();
    }
  }

  // Handle page unload
  private handlePageUnload() {
    this.setOnlineStatus(false);
    this.stopHeartbeat();
  }

  // Handle network online
  private handleNetworkOnline() {
    this.setOnlineStatus(true);
    this.startHeartbeat();
  }

  // Handle network offline
  private handleNetworkOffline() {
    this.setOnlineStatus(false);
    this.stopHeartbeat();
  }

  // Listen to a user's online status
  listenToUserOnlineStatus(userId: string, callback: (status: { isOnline: boolean; lastSeen: string | null }) => void) {
    this.listeners.set(userId, callback);

    // Set up real-time subscription for this user
    const channelId = `online_status_${userId}_${Math.random().toString(36).substring(2, 15)}`;
    const channel = supabase
      .channel(channelId)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'users',
        filter: `id=eq.${userId}`
      }, (payload) => {
        const newData = payload.new as any;
        callback({
          isOnline: newData.is_online || false,
          lastSeen: newData.last_seen || null
        });
      })
      .subscribe();

    // Return unsubscribe function
    return () => {
      this.listeners.delete(userId);
      supabase.removeChannel(channel);
    };
  }

  // Get current online status
  getCurrentStatus() {
    return {
      isOnline: this.isOnline,
      lastSeen: this.isOnline ? new Date().toISOString() : null
    };
  }

  // Cleanup
  cleanup() {
    this.setOnlineStatus(false);
    this.stopHeartbeat();
    this.listeners.clear();
    
    // Remove event listeners
    document.removeEventListener('visibilitychange', this.handleVisibilityChange.bind(this));
    window.removeEventListener('beforeunload', this.handlePageUnload.bind(this));
    window.removeEventListener('online', this.handleNetworkOnline.bind(this));
    window.removeEventListener('offline', this.handleNetworkOffline.bind(this));
  }
}

// Export a singleton instance for backward compatibility
export const onlineStatusService = OnlineStatusService.getInstance();