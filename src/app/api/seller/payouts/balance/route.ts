import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase-server';
import { PayoutService } from '@/lib/payout-service';

export async function GET(request: NextRequest) {
  try {
    const { data: { user }, error: authError } = await getAuthenticatedUser(request);

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const balanceData = await PayoutService.getSellerBalance(user.id);
    return NextResponse.json(balanceData);
  } catch (error) {
    console.error('Fetch seller balance error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
