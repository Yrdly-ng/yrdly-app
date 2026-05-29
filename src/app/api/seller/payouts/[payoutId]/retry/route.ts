import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { PayoutService } from '@/lib/payout-service';

export async function POST(
  request: Request,
  { params }: { params: { payoutId: string } }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.split(' ')[1];
    
    // Validate user via Supabase Auth
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payoutId = params.payoutId;

    // Verify ownership and status
    const { data: payout, error: fetchError } = await supabaseAdmin
      .from('payout_requests')
      .select('*')
      .eq('id', payoutId)
      .eq('seller_id', user.id)
      .single();

    if (fetchError || !payout) {
      return NextResponse.json({ error: 'Payout not found or unauthorized' }, { status: 404 });
    }

    if (payout.status !== 'failed') {
      return NextResponse.json({ error: 'Only failed payouts can be retried' }, { status: 400 });
    }

    // Reset status to pending so processPayout can pick it up
    const { error: updateError } = await supabaseAdmin
      .from('payout_requests')
      .update({ status: 'pending', failure_reason: null })
      .eq('id', payoutId);

    if (updateError) {
      return NextResponse.json({ error: 'Failed to reset payout status' }, { status: 500 });
    }

    // Attempt to process again
    await PayoutService.processPayout(payoutId);

    // Fetch the updated payout to return the new status
    const { data: updatedPayout } = await supabaseAdmin
      .from('payout_requests')
      .select('*')
      .eq('id', payoutId)
      .single();

    return NextResponse.json({ 
      success: true, 
      payout: updatedPayout 
    });

  } catch (error: any) {
    console.error('Error retrying payout:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to retry payout' },
      { status: 500 }
    );
  }
}
