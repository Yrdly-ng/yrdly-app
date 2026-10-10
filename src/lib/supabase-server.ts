import { authCookieDomain } from './auth-navigation';
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient as createJsClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";
import { AuthError, type UserResponse } from '@supabase/supabase-js';
import { isUserSuspendedOrBanned } from './user-suspension';

export async function createClient() {
  const cookieStore = await cookies();
  const reqHeaders = await headers();
  const host = reqHeaders.get("host") || "";
  const cookieDomain = authCookieDomain(host);

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: {
        name: 'sb-yoiyqxtpmxnrrbqqidcs-auth-token',
      },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              const finalOptions = {
                ...options,
                domain: cookieDomain,
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
export async function getAuthenticatedUser(request?: Request) {
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
      return authorizeAccount(await supabaseAuth.auth.getUser());
    }
  }

  // Fallback to cookie-based SSR client
  const supabase = await createClient();
  return authorizeAccount(await supabase.auth.getUser());
}

async function authorizeAccount(result: UserResponse): Promise<UserResponse> {
  if (result.error || !result.data.user) return result;
  try {
    const state = await isUserSuspendedOrBanned(result.data.user.id);
    if (state.suspended) return { data: { user: null }, error: new AuthError('Account suspended', 403) };
  } catch {
    return { data: { user: null }, error: new AuthError('Account status unavailable', 503) };
  }
  return result;
}
