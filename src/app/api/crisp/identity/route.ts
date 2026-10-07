import { createHmac } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase-server';

function jsonResponse(body: Record<string, string>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function GET(request: NextRequest) {
  try {
    const { data: { user }, error } = await getAuthenticatedUser(request);
    if (error || !user) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    if (!user.email || !user.email_confirmed_at) {
      return jsonResponse({ error: 'No verified email is available' }, 404);
    }

    const secret = process.env.CRISP_IDENTITY_SECRET;
    if (!secret) {
      console.error('[CrispIdentity] CRISP_IDENTITY_SECRET is not configured.');
      return jsonResponse({ error: 'Identity verification is unavailable' }, 503);
    }

    const signature = createHmac('sha256', secret).update(user.email).digest('hex');
    return NextResponse.json(
      { email: user.email, signature },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    console.error('[CrispIdentity] Failed to create an identity signature.');
    return jsonResponse({ error: 'Identity verification is unavailable' }, 500);
  }
}
