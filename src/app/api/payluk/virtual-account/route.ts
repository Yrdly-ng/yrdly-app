import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase-server';
import { getPaylukCustomerId } from '@/lib/payluk-onboarding';
import { PaylukService } from '@/lib/payluk-service';

/**
 * POST /api/payluk/virtual-account
 * Generates (or re-fetches) a virtual account for the authenticated user.
 * Passes Payluk's response through as-is — dedicated vs. temporary shape
 * normalisation is deferred to the caller (mobile).
 */
export async function POST(request: NextRequest) {
  const { data: { user }, error: authError } = await getAuthenticatedUser(request);
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const customerId = await getPaylukCustomerId(user.id);
    const account = await PaylukService.generateVirtualAccount(customerId);
    return NextResponse.json(account);
  } catch (err: any) {
    const msg: string = err?.message ?? 'Failed to generate virtual account';
    if (msg.includes('must have a verified phone number')) {
      return NextResponse.json({ error: 'PHONE_VERIFICATION_REQUIRED' }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
