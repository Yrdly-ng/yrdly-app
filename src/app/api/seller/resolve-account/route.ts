import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAuthenticatedUser } from '@/lib/supabase-server';
export async function POST(request: NextRequest) {
  try {
    // ── Authenticate ─────────────────────────────────────
    const { data: { user }, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    const body = await request.json();
    const { bankCode, accountNumber } = body;

    if (!bankCode || !accountNumber) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (!process.env.FLUTTERWAVE_SECRET_KEY) {
      console.warn('[ResolveAccount] FLUTTERWAVE_SECRET_KEY not set.');
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    // ── Call Flutterwave API ─────────────────────────────────────
    const flwRes = await fetch('https://api.flutterwave.com/v3/accounts/resolve', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        account_number: accountNumber,
        account_bank: bankCode,
      }),
    });

    const flwData = await flwRes.json();

    if (flwData.status === 'success' && flwData.data?.account_name) {
      return NextResponse.json({
        success: true,
        accountName: flwData.data.account_name,
      });
    } else {
      console.warn('[ResolveAccount] Flutterwave resolve failed:', flwData);
      return NextResponse.json(
        { error: flwData.message || 'Could not resolve account details.' },
        { status: 422 }
      );
    }
  } catch (error) {
    console.error('Account resolution error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
