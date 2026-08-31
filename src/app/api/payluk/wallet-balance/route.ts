import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase-server';
import { getPaylukCustomerId } from '@/lib/payluk-onboarding';
import { PaylukService } from '@/lib/payluk-service';

/**
 * GET /api/payluk/wallet-balance
 * Returns the authenticated user's Payluk mainBalance.
 */
export async function GET(request: NextRequest) {
  const { data: { user }, error: authError } = await getAuthenticatedUser(request);
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const customerId = await getPaylukCustomerId(user.id);
    const wallet = await PaylukService.getWallet(customerId);
    return NextResponse.json({ mainBalance: wallet.mainBalance, currency: wallet.currency });
  } catch (err: any) {
    console.error('[wallet-balance] Error fetching wallet:', err?.message ?? err);
    const msg: string = err?.message ?? '';
    if (msg.includes('must have a verified phone number')) {
      return NextResponse.json({ error: 'PHONE_VERIFICATION_REQUIRED' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Unable to fetch wallet balance' }, { status: 502 });
  }
}
