// local-1774541683066 is replaced at build time so each deploy gets a fresh cache
const CACHE_VERSION = 'local-1779614634534';
const CACHE_NAME = 'yrdly-' + CACHE_VERSION;
const STATIC_CACHE = 'yrdly-static-' + CACHE_VERSION;
const DATA_CACHE = 'yrdly-data-' + CACHE_VERSION;

// Files to cache immediately
const STATIC_FILES = [
  '/',
  '/offline.html',
  '/manifest.json',
  '/favicon.ico'
];



// Install event - cache static files
self.addEventListener('install', (event) => {
  console.log('Service Worker installing...');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('Caching static files');
        // Cache files one by one to handle failures gracefully
        return Promise.allSettled(
          STATIC_FILES.map(url => 
            cache.add(url).catch(error => {
              console.log(`Failed to cache ${url}:`, error);
              return null; // Continue with other files
            })
          )
        );
      })
      .then(() => {
        console.log('Static files caching completed');
        return self.skipWaiting();
      })
      .catch(error => {
        console.log('Service Worker install failed:', error);
        // Continue installation even if caching fails
        return self.skipWaiting();
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('Service Worker activating...');
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== STATIC_CACHE && cacheName !== DATA_CACHE) {
              console.log('Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log('Service Worker activated');
        return self.clients.claim();
      })
  );
});

// Fetch event - network first; do NOT cache /_next/ bundles so code
// changes are picked up immediately without a hard refresh.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle http/https
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (request.method !== 'GET') return;

  // Let Next.js static chunks bypass the SW entirely — they have
  // content-hashed filenames in production and must not be stale in dev.
  if (url.pathname.startsWith('/_next/')) return;

  // API routes — no caching
  if (url.pathname.startsWith('/api/')) return;

  // Page requests — network first, cache as offline fallback only
  event.respondWith(handlePageRequest(request));
});


// Handle static assets
async function handleStaticRequest(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }
  
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok && (request.url.startsWith('http:') || request.url.startsWith('https:'))) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    // Return offline page for critical assets
    if (request.url.includes('.css') || request.url.includes('.js')) {
      return caches.match('/offline.html');
    }
    throw error;
  }
}

// Handle page requests
async function handlePageRequest(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok && (request.url.startsWith('http:') || request.url.startsWith('https:'))) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    console.log('Page request failed, trying cache:', request.url);
    
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // Return offline page
    return caches.match('/offline.html');
  }
}



// Push notification handling
self.addEventListener('push', (event) => {
  console.log('Push notification received:', event);
  
  let notificationData = {
    title: 'Yrdly',
    body: 'New notification from Yrdly',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1
    }
  };

  // Parse push data if available
  if (event.data) {
    try {
      const data = event.data.json();
      notificationData = {
        ...notificationData,
        ...data,
        data: {
          ...notificationData.data,
          ...data.data
        }
      };
    } catch (e) {
      // Fallback to text if JSON parsing fails
      notificationData.body = event.data.text() || notificationData.body;
    }
  }

  const options = {
    body: notificationData.body,
    icon: notificationData.icon,
    badge: notificationData.badge,
    vibrate: [100, 50, 100],
    data: notificationData.data,
    actions: [
      {
        action: 'view',
        title: 'View',
        icon: '/favicon.ico'
      },
      {
        action: 'close',
        title: 'Close',
        icon: '/favicon.ico'
      }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(notificationData.title, options)
  );
});

// Handle messages from the main thread
self.addEventListener('message', (event) => {
  console.log('Service Worker received message:', event.data);

  if (!event.data) return;

  if (event.data.type === 'SHOW_NOTIFICATION') {
    const { payload } = event.data;
    
    const options = {
      body: payload.body,
      icon: payload.icon,
      badge: payload.badge,
      vibrate: [100, 50, 100],
      data: payload.data,
      actions: payload.actions || [
        {
          action: 'view',
          title: 'View',
          icon: '/favicon.ico'
        },
        {
          action: 'close',
          title: 'Close',
          icon: '/favicon.ico'
        }
      ]
    };

    self.registration.showNotification(payload.title, options);
  } else if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});


// Notification click handling
self.addEventListener('notificationclick', (event) => {
  console.log('Notification clicked:', event);
  
  event.notification.close();

  if (event.action === 'explore') {
    event.waitUntil(
      clients.openWindow('/')
    );
  }
});
