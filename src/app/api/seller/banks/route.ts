import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase-server';
import { PaylukService } from '@/lib/payluk-service';

export async function GET(request: NextRequest) {
  try {
    const { data: { user }, error } = await getAuthenticatedUser(request);
    if (error || !user) {
      return NextResponse.json({ error: 'Invalid session' }, {
        status: error?.status === 403 ? 403 : error?.status === 503 ? 503 : 401,
      });
    }

    const banks = await PaylukService.getBankList();
    return NextResponse.json({ success: true, banks });
  } catch (error) {
    console.error('[SellerBanks] Could not fetch Payluk banks:', error);
    return NextResponse.json({ error: 'Bank list is unavailable. Please try again.' }, { status: 503 });
  }
}
