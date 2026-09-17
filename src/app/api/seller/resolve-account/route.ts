import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase-server';
import { PaystackService } from '@/lib/paystack-service';
import { PaylukService } from '@/lib/payluk-service';

async function resolveHandler(bankCode: string, accountNumber: string, request: NextRequest) {
  const { data: { user }, error: authError } = await getAuthenticatedUser(request);
  if (authError || !user) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
  }
  if (!bankCode || !accountNumber) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  let result = await PaylukService.resolveAccount(user.id, accountNumber, bankCode);
  if (!result.valid || !result.accountName || result.accountName.includes('(Fallback)')) {
    result = await PaystackService.resolveAccount(accountNumber, bankCode);
  }

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
    const { searchParams } = new URL(request.url);
    const bankCode = searchParams.get('bank_code') ?? '';
    const accountNumber = searchParams.get('account_number') ?? '';

    let bodyBankCode = bankCode;
    let bodyAccountNumber = accountNumber;

    try {
      const body = await request.json();
      bodyBankCode = body.bankCode || body.bank_code || bankCode;
      bodyAccountNumber = body.accountNumber || body.account_number || accountNumber;
    } catch {
      // JSON body optional if query params were passed
    }

    return resolveHandler(bodyBankCode, bodyAccountNumber, request);
  } catch (error) {
    console.error('Account resolution error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
