import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase-server';
import { PayoutService } from '@/lib/payout-service';

export async function GET(request: NextRequest) {
  const { data: { user }, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Invalid session' }, {
    status: error?.status === 403 ? 403 : error?.status === 503 ? 503 : 401,
  });
  try {
    const payouts = await PayoutService.getSellerPayoutHistory(user.id);
    return NextResponse.json({ payouts });
  } catch (error) {
    console.error('Payout history failed:', error);
    return NextResponse.json({ error: 'Could not load payout history' }, { status: 503 });
  }
}
