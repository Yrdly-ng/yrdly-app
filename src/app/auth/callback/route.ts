import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const nextParam = requestUrl.searchParams.get('next');

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
    const userId = session.user.id;

    // Check if profile exists in public.users
    const { data: profile } = await supabase
      .from('users')
      .select('id, username, name, profile_completed')
      .eq('id', userId)
      .maybeSingle();

    // If profile does not exist yet (first-time Google OAuth sign in)
    if (!profile) {
      const googleName = session.user.user_metadata?.full_name || 
                         session.user.user_metadata?.name || 
                         session.user.user_metadata?.given_name || 
                         session.user.email?.split('@')[0] || 
                         'Neighbor';

      await supabase.from('users').insert({
        id: userId,
        name: googleName,
        email: session.user.email,
        avatar_url: session.user.user_metadata?.avatar_url || session.user.user_metadata?.picture,
        profile_completed: false,
        onboarding_status: 'profile_setup',
      });

      // Direct new Google OAuth user into onboarding profile setup
      return NextResponse.redirect(`${requestUrl.origin}/onboarding/profile`);
    }

    // If profile exists but onboarding is not completed
    if (!profile.profile_completed) {
      return NextResponse.redirect(`${requestUrl.origin}/onboarding/profile`);
    }

    // If explicit next parameter was requested (e.g. /reset-password)
    if (nextParam && nextParam !== '/home') {
      return NextResponse.redirect(`${requestUrl.origin}${nextParam}`);
    }

    return NextResponse.redirect(`${requestUrl.origin}/home`);
  }

  // Fallback to login if no session is established
  return NextResponse.redirect(`${requestUrl.origin}/login`);
}
