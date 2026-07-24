import { createClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase admin client using the service role key.
 * This bypasses Row Level Security (RLS) — ONLY use in API routes, never in client code.
 *
 * Add SUPABASE_SERVICE_ROLE_KEY to your .env.local — get it from:
 * Supabase Dashboard → Project Settings → API → service_role (secret)
 */
if (process.env.NODE_ENV === 'production' && (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)) {
  throw new Error('[Yrdly] Missing Supabase environment variables. Check your .env.local file.');
}
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('CRITICAL: Missing Supabase environment variables');
}

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);
