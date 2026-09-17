import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient as createJsClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";
import type { NextRequest } from "next/server";

export async function createClient() {
  const cookieStore = await cookies();
  const reqHeaders = await headers();
  const host = reqHeaders.get("host") || "";
  const isLocalhost = host.includes("localhost") || host.includes("127.0.0.1");

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              const finalOptions = {
                ...options,
                domain: isLocalhost ? undefined : (process.env.NEXT_PUBLIC_COOKIE_DOMAIN || '.yrdly.ng'),
              };
              cookieStore.set(name, value, finalOptions);
            });
          } catch {
            // The `setAll` method was called from a Server Component.
          }
        },
      },
    }
  );
}

/**
 * Robust authentication helper for Next.js API Routes.
 * Attempts to parse `Authorization: Bearer <token>` from the request headers.
 * If found, uses it directly (bulletproof for Incognito/Cookie-less environments).
 * Otherwise, falls back to the standard cookie-based client.
 */
export async function getAuthenticatedUser(request?: NextRequest) {
  if (request) {
    const authHeader = request.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "");
      const supabaseAuth = createJsClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { autoRefreshToken: false, persistSession: false },
        }
      );
      return supabaseAuth.auth.getUser();
    }
  }

  // Fallback to cookie-based SSR client
  const supabase = await createClient();
  return supabase.auth.getUser();
}
