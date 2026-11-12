'use client';

import { useEffect } from 'react';

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const register = () => {
      void navigator.serviceWorker.register('/sw.js')
        .catch((error) => console.error('SW registration failed:', error));
    };

    // React effects may mount after window.load. Register immediately in that
    // case instead of leaving serviceWorker.ready unresolved indefinitely.
    if (document.readyState === 'complete') {
      register();
      return;
    }
    window.addEventListener('load', register, { once: true });
    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
