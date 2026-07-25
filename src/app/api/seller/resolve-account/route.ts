import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase-server';
import { PaystackService } from '@/lib/paystack-service';

async function resolveHandler(bankCode: string, accountNumber: string, request: NextRequest) {
  const { data: { user }, error: authError } = await getAuthenticatedUser(request);
  if (authError || !user) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
  }
  if (!bankCode || !accountNumber) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }
  const result = await PaystackService.resolveAccount(accountNumber, bankCode);
  if (result.valid && result.accountName) {
    return NextResponse.json({ success: true, accountName: result.accountName });
  }
  return NextResponse.json(
    { error: 'Could not resolve account details. Please check your account number and bank.' },
    { status: 422 }
  );
}

/** GET /api/seller/resolve-account?bank_code=XXX&account_number=XXXXXXXXXX (used by mobile) */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const bankCode = searchParams.get('bank_code') ?? '';
    const accountNumber = searchParams.get('account_number') ?? '';
    return resolveHandler(bankCode, accountNumber, request);
  } catch (error) {
    console.error('Account resolution error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

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

    // ── Call Paystack API ─────────────────────────────────────
    const result = await PaystackService.resolveAccount(accountNumber, bankCode);

    if (result.valid && result.accountName) {
      return NextResponse.json({
        success: true,
        accountName: result.accountName,
      });
    } else {
      return NextResponse.json(
        { error: 'Could not resolve account details. Please check your account number and bank.' },
        { status: 422 }
      );
    }
  } catch (error) {
    console.error('Account resolution error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
