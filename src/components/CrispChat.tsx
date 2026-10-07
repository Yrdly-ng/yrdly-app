'use client';

import { useEffect, useRef } from 'react';
import Script from 'next/script';
import { useAuth } from '@/hooks/use-supabase-auth';

const websiteId = process.env.NEXT_PUBLIC_CRISP_WEBSITE_ID;

declare global {
  interface Window {
    $crisp: unknown[];
    CRISP_WEBSITE_ID?: string;
  }
}

export const isCrispEnabled = Boolean(websiteId);

let isCrispConfigured = false;

function getCrispQueue() {
  if (!isCrispConfigured) {
    window.$crisp = window.$crisp || [];
    window.CRISP_WEBSITE_ID = websiteId;
    isCrispConfigured = true;
  }
  return window.$crisp;
}

export function openCrispChat() {
  if (!websiteId || typeof window === 'undefined') return;

  const crisp = getCrispQueue();
  crisp.push(['do', 'chat:show']);
  crisp.push(['do', 'chat:open']);
}

export function CrispChat() {
  const { user, profile } = useAuth();
  const previousUserId = useRef<string | null>(null);
  const activeUserId = useRef<string | null>(user?.id ?? null);
  const activeEmail = useRef<string | null>(user?.email ?? null);
  activeUserId.current = user?.id ?? null;
  activeEmail.current = user?.email ?? null;

  useEffect(() => {
    if (!websiteId) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('Crisp chat is disabled: NEXT_PUBLIC_CRISP_WEBSITE_ID is not set.');
      }
      return;
    }

    const crisp = getCrispQueue();
    crisp.push(['do', 'chat:hide']);
    crisp.push([
      'on',
      'chat:closed',
      () => {
        window.$crisp.push(['do', 'chat:hide']);
      },
    ]);
  }, []);

  useEffect(() => {
    if (!websiteId) return;

    const crisp = getCrispQueue();
    const userId = user?.id ?? null;

    if (previousUserId.current !== null && previousUserId.current !== userId) {
      crisp.push(['do', 'session:reset', [false]]);
      crisp.push(['do', 'chat:hide']);
    }
    previousUserId.current = userId;

    if (!user) return;

    const currentProfile = profile?.id === user.id ? profile : null;
    const nickname = currentProfile?.name?.trim() || currentProfile?.username?.trim();

    if (nickname) crisp.push(['set', 'user:nickname', [nickname]]);

    const sessionData: [string, string | boolean][] = [['user_id', user.id]];
    if (typeof currentProfile?.phone_verified === 'boolean') {
      sessionData.push(['phone_verified', currentProfile.phone_verified]);
    }

    const area = {
      state: currentProfile?.location?.state ?? currentProfile?.home_state,
      lga: currentProfile?.location?.lga ?? currentProfile?.home_lga,
      city: currentProfile?.location?.city,
      ward: currentProfile?.location?.ward ?? currentProfile?.home_ward,
    };

    for (const [key, value] of Object.entries(area)) {
      if (typeof value === 'string' && value.trim()) {
        sessionData.push([key, value.trim()]);
      }
    }

    crisp.push(['set', 'session:data', [sessionData]]);
  }, [user, profile]);

  useEffect(() => {
    if (!websiteId || !user?.id || !user.email) return;

    const userId = user.id;
    const requestedEmail = user.email;
    let isCurrentRequest = true;

    const crisp = getCrispQueue();
    crisp.push(['set', 'user:email', [requestedEmail]]);

    fetch('/api/crisp/identity', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Identity signature unavailable');
        return response.json() as Promise<{ email?: string; signature?: string }>;
      })
      .then(({ email, signature }) => {
        if (
          !isCurrentRequest ||
          activeUserId.current !== userId ||
          activeEmail.current !== requestedEmail ||
          !email ||
          !signature
        ) return;
        getCrispQueue().push(['set', 'user:email', [email, signature]]);
      })
      .catch(() => {
        // The unsigned email was already set above and remains the fallback.
      });

    return () => {
      isCurrentRequest = false;
    };
  }, [user?.id, user?.email]);

  if (!websiteId) return null;

  const loader = `window.$crisp=window.$crisp||[];window.CRISP_WEBSITE_ID=${JSON.stringify(websiteId)};(function(){var d=document;var s=d.createElement("script");s.src="https://client.crisp.chat/l.js";s.async=1;d.getElementsByTagName("head")[0].appendChild(s);})();`;

  return (
    <Script
      id="crisp-chat-loader"
      strategy="lazyOnload"
      dangerouslySetInnerHTML={{ __html: loader }}
    />
  );
}
