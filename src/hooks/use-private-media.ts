"use client";

import { useEffect, useState } from 'react';
import { useAuth } from './use-supabase-auth';
import { authenticatedFetch } from '@/lib/authenticated-fetch';
import { parsePrivateMediaReference } from '@/lib/private-media';

export async function resolvePrivateMediaSource(source: string): Promise<string> {
  const reference = parsePrivateMediaReference(source);
  if (!reference) return source;
  const result = await authenticatedFetch<{ url: string }>('/api/media/sign', reference);
  return result.url;
}

export function usePrivateMedia(source: string) {
  const { user } = useAuth();
  const owner = user?.id;
  const [state, setState] = useState<{ source: string; owner?: string; url: string | null; error: boolean }>();
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const reference = parsePrivateMediaReference(source);
        if (reference && !owner) throw new Error('Please sign in again.');
        const url = await resolvePrivateMediaSource(source);
        if (stopped) return;
        setState({ source, owner, url, error: false });
        if (reference) timer = setTimeout(refresh, 240_000);
      } catch {
        if (!stopped) setState({ source, owner, url: null, error: true });
      }
    };
    void refresh();
    return () => { stopped = true; clearTimeout(timer); };
  }, [source, owner]);
  return state?.source === source && state.owner === owner ? state : { url: null, error: false };
}
