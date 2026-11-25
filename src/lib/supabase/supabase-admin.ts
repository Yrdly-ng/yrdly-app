import { brandedSupabaseUrl } from './supabase-url';
import 'server-only';
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase admin client using the service role key.
 * This bypasses Row Level Security (RLS) — ONLY use in API routes or server contexts.
 *
 * Initialization is intentionally lazy so Next.js can collect route metadata during
 * builds without requiring privileged database credentials. The client is created
 * only when a route actually uses it at runtime.
 */
let adminClient: SupabaseClient | undefined;

function getSupabaseAdmin(): SupabaseClient {
  if (adminClient) return adminClient;

  const supabaseUrl = brandedSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL || '');
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Server Supabase configuration is missing');
  }

  adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return adminClient;
}

export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, property) {
    const client = getSupabaseAdmin();
    const value = Reflect.get(client, property, client);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});
