import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';

interface OfflineAction {
  id: string;
  type: 'create_post' | 'send_message' | 'create_event' | 'create_business' | 'update_profile';
  data: any;
  timestamp: number;
  retryCount: number;
}

interface OfflineStatus {
  isOnline: boolean;
  isConnecting: boolean;
  lastOnline: Date | null;
  offlineActions: OfflineAction[];
  canSync: boolean;
}

export function useOffline() {
  const [status, setStatus] = useState<OfflineStatus>({
    isOnline: navigator.onLine,
    isConnecting: false,
    lastOnline: navigator.onLine ? new Date() : null,
    offlineActions: [],
    canSync: false
  });

  const [isFirestoreOnline, setIsFirestoreOnline] = useState(true);
  const offlineActionsRef = useRef<OfflineAction[]>([]);
  const syncInProgressRef = useRef(false);

  // Save offline actions to localStorage
  const saveOfflineActions = useCallback((actions: OfflineAction[]) => {
    try {
      localStorage.setItem('yrdly-offline-actions', JSON.stringify(actions));
    } catch (error) {
      console.error('Failed to save offline actions:', error);
    }
  }, []);

  // Add offline action
  const addOfflineAction = useCallback((action: Omit<OfflineAction, 'id' | 'timestamp' | 'retryCount'>) => {
    const newAction: OfflineAction = {
      ...action,
      id: `${action.type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      retryCount: 0
    };

    const updatedActions = [...offlineActionsRef.current, newAction];
    offlineActionsRef.current = updatedActions;
    
    setStatus(prev => ({
      ...prev,
      offlineActions: updatedActions
    }));

    saveOfflineActions(updatedActions);
    
    return newAction.id;
  }, [saveOfflineActions]);

  // Remove offline action
  const removeOfflineAction = useCallback((actionId: string) => {
    const updatedActions = offlineActionsRef.current.filter(action => action.id !== actionId);
    offlineActionsRef.current = updatedActions;
    
    setStatus(prev => ({
      ...prev,
      offlineActions: updatedActions
    }));

    saveOfflineActions(updatedActions);
  }, [saveOfflineActions]);

  // Update offline action retry count
  const updateActionRetryCount = useCallback((actionId: string, retryCount: number) => {
    const updatedActions = offlineActionsRef.current.map(action =>
      action.id === actionId ? { ...action, retryCount } : action
    );
    offlineActionsRef.current = updatedActions;
    
    setStatus(prev => ({
      ...prev,
      offlineActions: updatedActions
    }));

    saveOfflineActions(updatedActions);
  }, [saveOfflineActions]);

  // Create post from offline data
  const createPostFromOffline = useCallback(async (data: any) => {
    try {
      const { data: newPost, error } = await supabase
        .from('posts')
        .insert({
          ...data,
          created_at: new Date().toISOString(),
          is_offline_created: true,
          synced_at: new Date().toISOString(),
          status: 'pending_sync'
        })
        .select('id')
        .single();
      
      if (error) throw error;
      
      return newPost.id;
    } catch (error) {
      console.error('Failed to create offline post:', error);
      throw error;
    }
  }, []);

  // Send message from offline data
  const sendMessageFromOffline = useCallback(async (data: any) => {
    try {
      const { data: newMessage, error } = await supabase
        .from('messages')
        .insert({
          ...data,
          timestamp: new Date().toISOString(),
          is_offline_sent: true,
          synced_at: new Date().toISOString(),
          status: 'pending_sync',
          is_read: true // Mark as read for the sender
        })
        .select('id')
        .single();
      
      if (error) throw error;
      
      return newMessage.id;
    } catch (error) {
      console.error('Failed to create offline message:', error);
      throw error;
    }
  }, []);

  // Create event from offline data
  const createEventFromOffline = useCallback(async (data: any) => {
    try {
      const { data: newEvent, error } = await supabase
        .from('events')
        .insert({
          ...data,
          created_at: new Date().toISOString(),
          is_offline_created: true,
          synced_at: new Date().toISOString(),
          status: 'pending_sync'
        })
        .select('id')
        .single();
      
      if (error) throw error;
      
      return newEvent.id;
    } catch (error) {
      console.error('Failed to create offline event:', error);
      throw error;
    }
  }, []);

  // Create business from offline data
  const createBusinessFromOffline = useCallback(async (data: any) => {
    try {
      const { data: newBusiness, error } = await supabase
        .from('businesses')
        .insert({
          ...data,
          created_at: new Date().toISOString(),
          is_offline_created: true,
          synced_at: new Date().toISOString(),
          status: 'pending_sync'
        })
        .select('id')
        .single();
      
      if (error) throw error;
      
      return newBusiness.id;
    } catch (error) {
      console.error('Failed to create offline business:', error);
      throw error;
    }
  }, []);

  // Update profile from offline data
  const updateProfileFromOffline = useCallback(async (data: any) => {
    try {
      const { userId, ...profileData } = data;
      const { error } = await supabase
        .from('users')
        .update({
          ...profileData,
          updated_at: new Date().toISOString(),
          is_offline_updated: true,
          synced_at: new Date().toISOString(),
          status: 'pending_sync'
        })
        .eq('id', userId);
      
      return userId;
    } catch (error) {
      console.error('Failed to update offline profile:', error);
      throw error;
    }
  }, []);

  // Perform specific offline action
  const performOfflineAction = useCallback(async (action: OfflineAction) => {
    try {
      switch (action.type) {
        case 'create_post':
          return await createPostFromOffline(action.data);
        case 'send_message':
          return await sendMessageFromOffline(action.data);
        case 'create_event':
          return await createEventFromOffline(action.data);
        case 'create_business':
          return await createBusinessFromOffline(action.data);
        case 'update_profile':
          return await updateProfileFromOffline(action.data);
        default:
          throw new Error(`Unknown action type: ${action.type}`);
      }
    } catch (error) {
      console.error(`Failed to perform offline action ${action.type}:`, error);
      
      // If it's a network error, don't remove the action - let it retry
      if (error instanceof Error && error.message.includes('network')) {
        throw error;
      }
      
      // For other errors, log and continue
      console.warn(`Action ${action.type} failed with non-network error:`, error);
      return null; // Mark as "handled" but not successful
    }
  }, [createPostFromOffline, sendMessageFromOffline, createEventFromOffline, createBusinessFromOffline, updateProfileFromOffline]);

  // Sync offline data - now all functions are defined
  const syncOfflineData = useCallback(async () => {
    if (syncInProgressRef.current || !status.isOnline || !isFirestoreOnline) {
      return;
    }

    syncInProgressRef.current = true;
    setStatus(prev => ({ ...prev, isConnecting: true }));

    try {
      const actions = [...offlineActionsRef.current];

      for (const action of actions) {
        try {
          await performOfflineAction(action);
          removeOfflineAction(action.id);
        } catch (error) {
          console.error('Failed to sync action:', action.id, error);
          
          // Increment retry count
          const newRetryCount = action.retryCount + 1;
          updateActionRetryCount(action.id, newRetryCount);

          // Remove action if retry limit exceeded
          if (newRetryCount >= 3) {
            console.warn('Removing action after max retries:', action.id);
            removeOfflineAction(action.id);
          }
        }
      }

    } catch (error) {
      console.error('Offline sync failed:', error);
    } finally {
      syncInProgressRef.current = false;
      setStatus(prev => ({ ...prev, isConnecting: false }));
    }
  }, [status.isOnline, isFirestoreOnline, removeOfflineAction, updateActionRetryCount, performOfflineAction]);

  // Manual sync trigger
  const triggerSync = useCallback(() => {
    if (status.canSync && !status.isConnecting) {
      syncOfflineData();
    }
  }, [status.canSync, status.isConnecting, syncOfflineData]);

  // Clear all offline actions (for testing)
  const clearOfflineActions = useCallback(() => {
    offlineActionsRef.current = [];
    setStatus(prev => ({ ...prev, offlineActions: [] }));
    saveOfflineActions([]);
  }, [saveOfflineActions]);

  // Network status monitoring - now syncOfflineData is defined
  useEffect(() => {
    const handleOnline = () => {
      setStatus(prev => ({
        ...prev,
        isOnline: true,
        lastOnline: new Date(),
        canSync: true
      }));
      
      // Trigger sync when back online
      if (offlineActionsRef.current.length > 0) {
        setTimeout(() => {
          syncOfflineData();
        }, 100);
      }
    };

    const handleOffline = () => {
      setStatus(prev => ({
        ...prev,
        isOnline: false,
        canSync: false
      }));
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [syncOfflineData]);

  // Track connection status using browser's native online/offline events
  // (avoids redundant DB polling — this hook is mounted in multiple places)
  useEffect(() => {
    setIsFirestoreOnline(navigator.onLine);

    const handleOnlineStatus = () => setIsFirestoreOnline(navigator.onLine);
    window.addEventListener('online', handleOnlineStatus);
    window.addEventListener('offline', handleOnlineStatus);

    return () => {
      window.removeEventListener('online', handleOnlineStatus);
      window.removeEventListener('offline', handleOnlineStatus);
    };
  }, []);

  // Load offline actions from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem('yrdly-offline-actions');
      if (stored) {
        const actions = JSON.parse(stored);
        offlineActionsRef.current = actions;
        setStatus(prev => ({
          ...prev,
          offlineActions: actions
        }));
      }
    } catch (error) {
      console.error('Failed to load offline actions:', error);
    }
  }, []);

  return {
    // Status
    isOnline: status.isOnline,
    isConnecting: status.isConnecting,
    isFirestoreOnline,
    lastOnline: status.lastOnline,
    offlineActions: status.offlineActions,
    canSync: status.canSync,
    
    // Actions
    addOfflineAction,
    removeOfflineAction,
    syncOfflineData,
    triggerSync,
    clearOfflineActions,
    
    // Computed
    hasOfflineActions: status.offlineActions.length > 0,
    pendingActionsCount: status.offlineActions.length
  };
}