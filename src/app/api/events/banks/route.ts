import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase/supabase-server';
import { PaystackService, getPaystackEventMode } from '@/lib/payments/paystack-service';

export async function GET(request: NextRequest) {
  try {
    const { data: { user }, error } = await getAuthenticatedUser(request);
    if (error || !user) return NextResponse.json({ error: 'Invalid session' }, { status: error?.status || 401 });
    if (!getPaystackEventMode()) return NextResponse.json({ error: 'Paystack event payments are not enabled.' }, { status: 503 });
    const accountNumber = request.nextUrl.searchParams.get('account_number');
    const bankCode = request.nextUrl.searchParams.get('bank_code');
    if (accountNumber && bankCode) return NextResponse.json({ account: await PaystackService.resolveAccount(accountNumber, bankCode) });
    return NextResponse.json({ banks: await PaystackService.listBanks() });
  } catch {
    return NextResponse.json({ error: 'Bank details could not be loaded or verified.' }, { status: 503 });
  }
}
