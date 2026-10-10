import { PaylukService } from '@/lib/payluk-service';
import { getPaylukCustomerId } from '@/lib/payluk-onboarding';
import { getAuthenticatedUser } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { PayoutService } from '@/lib/payout-service';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ payoutId: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Validate user via Supabase Auth
    const { data: { user }, error: authError } = await getAuthenticatedUser(request);
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: authError?.status === 403 ? 403 : authError?.status === 503 ? 503 : 401 });
    }

    const { payoutId } = await params;

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

    if (!['failed', 'processing'].includes(payout.status)) {
      return NextResponse.json({ error: 'Only failed or processing payouts can be reconciled' }, { status: 409 });
    }
    if (payout.payment_provider !== 'payluk') {
      return NextResponse.json({ error: 'Payout provider is unknown or unsupported. Support must reconcile this request.' }, { status: 409 });
    }
    if (payout.transaction_reference) {
      const outcome = await PaylukService.getWithdrawalStatus(await getPaylukCustomerId(user.id), payout.transaction_reference);
      if (outcome === 'pending') return NextResponse.json({ error: 'Transfer is uncertain or still processing; funds remain reserved.' }, { status: 409 });
      if (outcome === 'success') {
        const { data: reconciled, error } = await supabaseAdmin.from('payout_requests').update({ status: 'completed', processed_at: new Date().toISOString() }).eq('id', payoutId).in('status', ['failed','processing']).select('id');
        if (error || !reconciled?.length) throw error || new Error('Payout state changed. Refresh and retry reconciliation.');
        return NextResponse.json({ success: true, reconciled: true });
      }
    } else {
      return NextResponse.json({ error: 'Legacy payout has no durable provider reference. Support must reconcile it before retry.' }, { status: 409 });
    }
    // Re-reserve under the same seller lock used by new withdrawal requests.
    const balance = await PayoutService.getSellerBalance(user.id);
    const { data: reset, error: updateError } = await supabaseAdmin.rpc('requeue_seller_payout', {
      p_payout_id:payoutId,p_seller_id:user.id,p_wallet_limit:balance.availableBalance+balance.pendingPayouts,
    });

    if (updateError) {
      return NextResponse.json({ error: 'Failed to reset payout status' }, { status: 500 });
    }
    if (!reset) {
      return NextResponse.json({ error: 'Payout cannot be retried with the current available balance or account.' }, { status: 409 });
    }

    // Attempt to process again
    const result = await PayoutService.processPayout(payoutId);

    // Fetch the updated payout to return the new status
    const { data: updatedPayout } = await supabaseAdmin
      .from('payout_requests')
      .select('*')
      .eq('id', payoutId)
      .single();

    return NextResponse.json({ 
      success: result.success,
      error: result.success ? undefined : result.error,
      payout: updatedPayout 
    }, { status: result.success ? 200 : 502 });

  } catch (error: any) {
    console.error('Error retrying payout:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to retry payout' },
      { status: 500 }
    );
  }
}
