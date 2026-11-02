import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase/supabase-server';
import { EventFinanceError, requestEventWithdrawal } from '@/lib/events/paystack-event-finance';

import { paylukEventEnvironment } from '@/lib/events/payluk-event-finance-config';
import { advancePaylukEventWithdrawal, requestPaylukEventWithdrawal } from '@/lib/events/payluk-event-finance';

const publicWithdrawal = (row: Record<string, unknown> | null | undefined) => row ? { id: row.id, reference: row.reference, status: row.status, amount_kobo: row.amount_kobo } : null;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { data: { user }, error } = await getAuthenticatedUser(request);
    if (error || !user) return NextResponse.json({ error: 'Invalid session' }, { status: error?.status || 401 });
    const input = await request.json().catch(() => null);
    if (!input || typeof input !== 'object') return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
    if (input.provider === 'payluk') {
      if (input.resumeReference !== undefined) {
        if (typeof input.resumeReference !== 'string' || !/^evt-plk-[a-f0-9-]{36}$/.test(input.resumeReference)) return NextResponse.json({ error: 'Invalid withdrawal reference.' }, { status: 400 });
        const withdrawal = await advancePaylukEventWithdrawal(input.resumeReference, user.id, (await params).id);
        return NextResponse.json({ success: true, sandbox: paylukEventEnvironment() === 'test', withdrawal: publicWithdrawal(withdrawal) });
      }
      const withdrawal = await requestPaylukEventWithdrawal((await params).id, user.id, input);
      return NextResponse.json({ success: true, sandbox: paylukEventEnvironment() === 'test', withdrawal: publicWithdrawal(withdrawal) });
    }
    if (input.provider && input.provider !== 'paystack') return NextResponse.json({ error: 'Invalid payment provider.' }, { status: 400 });
    if (typeof input.bankCode !== 'string' || typeof input.accountNumber !== 'string') return NextResponse.json({ error: 'Bank details are required.' }, { status: 400 });
    const withdrawal = await requestEventWithdrawal((await params).id, user.id, input);
    return NextResponse.json({ success: true, sandbox: true, withdrawal });
  } catch (error) {
    return NextResponse.json({ error: error instanceof EventFinanceError ? error.message : 'The withdrawal could not be confirmed. Refresh its existing status before retrying.' }, { status: error instanceof EventFinanceError ? error.status : 503 });
  }
}
