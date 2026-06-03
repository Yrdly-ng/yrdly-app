"use client";

import React, { useEffect, useState, useCallback } from 'react';
import { useOffline } from '@/hooks/use-offline';

export function ServiceWorkerRegistration() {
  const [isUpdateAvailable, setIsUpdateAvailable] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const { triggerSync } = useOffline();

  const registerServiceWorker = useCallback(async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');

      // Handle updates
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              setIsUpdateAvailable(true);
            }
          });
        }
      });

      // Handle controller change (new service worker activated)
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        // Trigger sync when new service worker takes control
        setTimeout(() => {
          triggerSync();
        }, 1000);
      });

      // Handle service worker messages
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'SYNC_COMPLETED') {
          // Background sync completed
        }
      });

    } catch (error) {
      console.error('Service Worker registration failed:', error);
    }
  }, [triggerSync]);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      registerServiceWorker();
    }
  }, [registerServiceWorker]);

  const updateServiceWorker = async () => {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      setIsInstalling(true);
      
      try {
        // Send message to service worker to skip waiting
        navigator.serviceWorker.controller.postMessage({
          type: 'SKIP_WAITING'
        });

        // Reload the page after a short delay
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      } catch (error) {
        console.error('Failed to update service worker:', error);
        setIsInstalling(false);
      }
    }
  };

  // Don't render anything if no update is available
  if (!isUpdateAvailable) {
    return null;
  }

  return (
    <div className="fixed top-4 right-4 z-50">
      <div className="bg-blue-500 text-foreground rounded-lg shadow-lg p-4 max-w-sm">
        <div className="flex items-center space-x-3">
          <div className="flex-shrink-0">
            <div className="w-6 h-6 bg-background bg-opacity-20 rounded-full flex items-center justify-center">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
              </svg>
            </div>
          </div>
          
          <div className="flex-1">
            <h3 className="text-sm font-medium">Update Available</h3>
            <p className="text-xs text-blue-100 mt-1">
              A new version is ready. Update to get the latest features.
            </p>
          </div>
        </div>
        
        <div className="mt-3 flex space-x-2">
          <button
            onClick={updateServiceWorker}
            disabled={isInstalling}
            className="flex-1 bg-background text-blue-600 text-sm font-medium py-2 px-3 rounded-md hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isInstalling ? 'Updating...' : 'Update Now'}
          </button>
          
          <button
            onClick={() => setIsUpdateAvailable(false)}
            className="px-3 py-2 text-sm text-blue-100 hover:text-foreground transition-colors"
          >
            Later
          </button>
        </div>
      </div>
    </div>
  );
}

// Hook for checking service worker status
export function useServiceWorkerStatus() {
  const [status, setStatus] = useState<'installed' | 'updated' | 'error' | null>(null);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then((registration) => {
        if (registration.active) {
          setStatus('installed');
        }
      });

      navigator.serviceWorker.addEventListener('controllerchange', () => {
        setStatus('updated');
      });
    }
  }, []);

  return status;
}

