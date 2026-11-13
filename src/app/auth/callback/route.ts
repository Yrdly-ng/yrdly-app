import { readOAuthAttribution, type SignupAttribution } from '@/lib/attribution/signup';
import { captureNewOAuthAccount } from '@/lib/attribution/server-events';
import { safeRelativePath } from '@/lib/auth/auth-navigation';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/supabase-server';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const nextParam = requestUrl.searchParams.get('next');
  const safeNext = safeRelativePath(nextParam, '', requestUrl.origin);
  const onboardingRedirect = (path: string) => {
    const url = new URL(path, requestUrl.origin);
    if (safeNext) url.searchParams.set('next', safeNext);
    return NextResponse.redirect(url);
  };

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error('Auth callback exchange error:', error);
      return NextResponse.redirect(`${requestUrl.origin}/login?error=${encodeURIComponent(error.message)}`);
    }
  }

  // Get current active session
  const { data: { session } } = await supabase.auth.getSession();

  if (session?.user) {
    // Password recovery must work even when signup/onboarding was interrupted.
    if (safeNext === '/reset-password') {
      return NextResponse.redirect(new URL(safeNext, requestUrl.origin));
    }

    const userId = session.user.id;

    // Check if profile exists in public.users
    const { data: profile } = await supabase
      .from('users')
      .select('id, username, name, phone, phone_verified, profile_completed')
      .eq('id', userId)
      .maybeSingle();

    // Only newly created OAuth accounts are attributable as new signups.
    // An old user whose public profile was deleted must NOT count again.
    const authProvider = session.user.app_metadata?.provider;
    const createdAgo = Date.now() - Date.parse(session.user.created_at);
    const newOAuthMethod: "google" | "apple" | null =
      (authProvider === "google" || authProvider === "apple") &&
      Number.isFinite(createdAgo) && createdAgo >= -60_000 && createdAgo < 600_000
        ? authProvider : null;

    // If profile does not exist yet (first-time Google OAuth sign in)
    if (!profile) {
      const googleName = session.user.user_metadata?.full_name || 
                         session.user.user_metadata?.name || 
                         session.user.user_metadata?.given_name || 
                         session.user.email?.split('@')[0] || 
                         'Neighbor';

      const { error: profileError } = await supabase.from('users').insert({
        id: userId,
        name: googleName,
        email: session.user.email,
        avatar_url: session.user.user_metadata?.avatar_url || session.user.user_metadata?.picture,
        profile_completed: false,
        onboarding_status: 'profile_setup',
      });

      if (profileError) {
        console.error('Auth callback profile creation error:', profileError);
        return NextResponse.redirect(`${requestUrl.origin}/login?error=${encodeURIComponent('Could not create your profile. Please try again.')}`);
      }

      if (newOAuthMethod) {
        const unknown = { source: "unknown", medium: "unknown" };
        const attribution: SignupAttribution = readOAuthAttribution(requestUrl) ?? {
          version: 1, first: unknown, last: unknown,
          captured_at: new Date().toISOString(),
        };
        // Store the same bounded marketing source with the authenticated
        // identity. This is analytics metadata, never an authorization claim.
        const { error: metadataError } = await supabase.auth.updateUser({
          data: { signup_attribution: attribution },
        });
        if (metadataError) console.warn("Could not attach OAuth signup attribution");
        await captureNewOAuthAccount(userId, newOAuthMethod, attribution);
        // Browser-based Google Ads tag may report one real signup after login;
        // browser verifies account age before acting on this routing marker.
        return onboardingRedirect('/onboarding/verify-phone?new_signup=' + newOAuthMethod);
      }
      return onboardingRedirect('/onboarding/verify-phone');
    }

    // Incomplete OAuth profiles must verify a phone before profile setup.
    if (!profile.profile_completed) {
      if (!profile.phone) {
        return onboardingRedirect('/onboarding/verify-phone');
      }
      return onboardingRedirect('/onboarding/profile');
    }

    // If explicit next parameter was requested (e.g. /reset-password)
    if (safeNext && safeNext !== '/home') {
      return NextResponse.redirect(new URL(safeNext, requestUrl.origin));
    }

    return NextResponse.redirect(`${requestUrl.origin}/home`);
  }

  // Fallback to login if no session is established
  return NextResponse.redirect(`${requestUrl.origin}/login`);
}
