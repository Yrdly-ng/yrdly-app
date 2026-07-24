import React, { useState, useEffect } from 'react';
import { Wifi, WifiOff, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';
import { useOffline } from '@/hooks/use-offline';

export function OfflineStatus() {
  const {
    isOnline,
    isConnecting,
    offlineActions,
    hasOfflineActions,
    pendingActionsCount,
    triggerSync,
    clearOfflineActions
  } = useOffline();

  const [showSuccessMessage, setShowSuccessMessage] = useState(false);
  const [isSlow, setIsSlow] = useState(false);

  useEffect(() => {
    if (typeof navigator !== "undefined" && "connection" in navigator) {
      const connection = (navigator as any).connection;
      const updateConnectionStatus = () => {
        setIsSlow(connection && (connection.effectiveType === "2g" || connection.saveData === true));
      };
      updateConnectionStatus();
      connection.addEventListener("change", updateConnectionStatus);
      return () => connection.removeEventListener("change", updateConnectionStatus);
    }
  }, []);

  // Auto-dismiss success message after 4 seconds
  useEffect(() => {
    if (showSuccessMessage) {
      const timer = setTimeout(() => {
        setShowSuccessMessage(false);
      }, 4000);

      return () => clearTimeout(timer);
    }
  }, [showSuccessMessage]);

  // Show success message when all actions are synced
  useEffect(() => {
    if (isOnline && !hasOfflineActions && !isConnecting) {
      setShowSuccessMessage(true);
    }
  }, [isOnline, hasOfflineActions, isConnecting]);

  if (isOnline && !hasOfflineActions && !showSuccessMessage && !isSlow) {
    return null; // Don't show anything when online, fast, and no pending actions
  }

  return (
    <div className="fixed bottom-20 left-4 z-50 pb-[env(safe-area-inset-bottom)]">
      <div className="bg-background dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-4 max-w-sm">
        {/* Status Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2">
            {isOnline ? (
              <>
                <Wifi className="w-4 h-4 text-green-500" />
                <span className="text-sm font-medium text-gray-900 dark:text-foreground">
                  Online
                </span>
              </>
            ) : (
              <>
                <WifiOff className="w-4 h-4 text-red-500" />
                <span className="text-sm font-medium text-gray-900 dark:text-foreground">
                  Offline
                </span>
              </>
            )}
          </div>
          
          {hasOfflineActions && (
            <div className="flex items-center space-x-1">
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {pendingActionsCount} pending
              </span>
            </div>
          )}
        </div>

        {/* Offline Actions */}
        {hasOfflineActions && (
          <div className="space-y-2 mb-3">
            <div className="text-xs font-medium text-gray-700 dark:text-gray-300">
              Pending Actions:
            </div>
            
            {offlineActions.slice(0, 3).map((action) => (
              <div key={action.id} className="flex items-center justify-between text-xs">
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 bg-yellow-400 rounded-full"></div>
                  <span className="text-gray-600 dark:text-gray-400">
                    {formatActionType(action.type)}
                  </span>
                </div>
                
                {action.retryCount > 0 && (
                  <span className="text-red-500 text-xs">
                    Retry {action.retryCount}/3
                  </span>
                )}
              </div>
            ))}
            
            {offlineActions.length > 3 && (
              <div className="text-xs text-gray-500 dark:text-gray-400">
                +{offlineActions.length - 3} more actions
              </div>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex space-x-2">
          {isOnline && hasOfflineActions && (
            <button
              onClick={triggerSync}
              disabled={isConnecting}
              className="flex-1 flex items-center justify-center space-x-2 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-foreground text-xs font-medium py-2 px-3 rounded-md transition-colors"
            >
              {isConnecting ? (
                <>
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  <span>Syncing...</span>
                </>
              ) : (
                <>
                  <RefreshCw className="w-3 h-3" />
                  <span>Sync Now</span>
                </>
              )}
            </button>
          )}
          
          {hasOfflineActions && (
            <button
              onClick={clearOfflineActions}
              className="px-3 py-2 text-xs text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 font-medium transition-colors"
            >
              Clear All
            </button>
          )}
        </div>

        {/* Sync Status */}
        {isConnecting && (
          <div className="mt-3 flex items-center space-x-2 text-xs text-blue-600 dark:text-blue-400">
            <RefreshCw className="w-3 h-3 animate-spin" />
            <span>Synchronizing data...</span>
          </div>
        )}

        {/* Success Message */}
        {showSuccessMessage && (
          <div className="mt-3 flex items-center space-x-2 text-xs text-green-600 dark:text-green-400">
            <CheckCircle className="w-3 h-3" />
            <span>All data synced</span>
          </div>
        )}

        {/* Offline Warning */}
        {!isOnline && (
          <div className="mt-3 flex items-center space-x-2 text-xs text-yellow-600 dark:text-yellow-400">
            <AlertCircle className="w-3 h-3" />
            <span>Changes will sync when online</span>
          </div>
        )}

        {/* Slow Connection Warning */}
        {isOnline && isSlow && (
          <div className="mt-3 flex items-center space-x-2 text-xs text-amber-600 dark:text-amber-500 bg-amber-50 dark:bg-amber-950/30 p-2 rounded-md">
            <Wifi className="w-3 h-3 animate-pulse" />
            <span>Slow connection — some content may load slowly</span>
          </div>
        )}
      </div>
    </div>
  );
}

// Helper function to format action types
function formatActionType(type: string): string {
  const typeMap: Record<string, string> = {
    'create_post': 'Create Post',
    'send_message': 'Send Message',
    'create_event': 'Create Event',
    'create_business': 'Create Business',
    'update_profile': 'Update Profile'
  };
  
  return typeMap[type] || type;
}

// Compact version for mobile
export function OfflineStatusCompact() {
  const { isOnline, hasOfflineActions, pendingActionsCount } = useOffline();

  if (isOnline && !hasOfflineActions) {
    return null;
  }

  return (
    <div className="fixed bottom-20 left-4 z-50 pb-[env(safe-area-inset-bottom)]">
      <div className="bg-background dark:bg-gray-800 rounded-full shadow-lg border border-gray-200 dark:border-gray-700 p-2">
        <div className="flex items-center space-x-2">
          {isOnline ? (
            <Wifi className="w-4 h-4 text-green-500" />
          ) : (
            <WifiOff className="w-4 h-4 text-red-500" />
          )}
          
          {hasOfflineActions && (
            <div className="bg-red-500 text-primary-foreground text-xs rounded-full w-5 h-5 flex items-center justify-center">
              {pendingActionsCount > 9 ? '9+' : pendingActionsCount}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
