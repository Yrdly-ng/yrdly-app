import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/** New Supabase secret keys belong on apikey, never on Authorization: Bearer. */
export async function invokeServerFunction<T = any>(client: SupabaseClient, name: string, body: Record<string, unknown>): Promise<{ data: T | null; error: { message: string } | null }> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key?.startsWith('sb_secret_')) return client.functions.invoke<T>(name, { body });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return { data: null, error: { message: 'Server function configuration is missing' } };
  try {
    const response = await fetch(`${url}/functions/v1/${encodeURIComponent(name)}`, {
      method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10000), cache: 'no-store',
    });
    if (!response.ok) return { data: null, error: { message: `Server function returned HTTP ${response.status}` } };
    return { data: await response.json() as T, error: null };
  } catch {
    return { data: null, error: { message: 'Server function request failed' } };
  }
}
