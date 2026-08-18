import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase-server';

export async function GET(request: NextRequest) {
  try {
    const { data: { user }, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!secretKey) {
      console.error('[Paystack Banks] CRITICAL: PAYSTACK_SECRET_KEY is not set');
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const res = await fetch('https://api.paystack.co/bank?currency=NGN', {
      headers: {
        Authorization: `Bearer ${secretKey}`
      }
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error('[Paystack Banks] Paystack API error:', errorText);
      return NextResponse.json({ error: 'Failed to fetch banks from Paystack' }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('[Paystack Banks] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
