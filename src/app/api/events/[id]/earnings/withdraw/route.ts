import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase/supabase-server';
import { EventFinanceError, requestEventWithdrawal } from '@/lib/events/paystack-event-finance';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { data: { user }, error } = await getAuthenticatedUser(request);
    if (error || !user) return NextResponse.json({ error: 'Invalid session' }, { status: error?.status || 401 });
    const input = await request.json();
    if (typeof input.bankCode !== 'string' || typeof input.accountNumber !== 'string') return NextResponse.json({ error: 'Bank details are required.' }, { status: 400 });
    const withdrawal = await requestEventWithdrawal((await params).id, user.id, input);
    return NextResponse.json({ success: true, sandbox: true, withdrawal });
  } catch (error) {
    return NextResponse.json({ error: error instanceof EventFinanceError ? error.message : 'The withdrawal could not be confirmed. Refresh its existing status before retrying.' }, { status: error instanceof EventFinanceError ? error.status : 503 });
  }
}
