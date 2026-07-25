import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    
    if (error) {
      console.error('Auth callback exchange error:', error);
      return NextResponse.redirect(`${requestUrl.origin}/login?error=${encodeURIComponent(error.message)}`);
    }
  }

  // Check if we have an active session
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();

  if (session) {
    return NextResponse.redirect(`${requestUrl.origin}/home`);
  }

  // Fallback to login if no session is established
  return NextResponse.redirect(`${requestUrl.origin}/login`);
}
