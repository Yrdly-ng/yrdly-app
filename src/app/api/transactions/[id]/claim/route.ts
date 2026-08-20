import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { EscrowStatus } from '@/types/escrow';
import { MARKETPLACE_CONSTANTS } from '@/lib/constants';
import { PayoutService } from '@/lib/payout-service';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;
    const transactionId = resolvedParams.id;

    if (!transactionId) {
      return NextResponse.json({ error: 'Transaction ID is required' }, { status: 400 });
    }

    const authHeader = request.headers.get('Authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: transaction, error: fetchError } = await supabaseAdmin
      .from('escrow_transactions')
      .select('status, seller_id, shipped_at, payment_provider')
      .eq('id', transactionId)
      .single();

    if (fetchError || !transaction) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    if (transaction.seller_id !== user.id) {
      return NextResponse.json({ error: 'Only the seller can claim funds' }, { status: 403 });
    }

    if (transaction.status !== EscrowStatus.SHIPPED && transaction.status !== EscrowStatus.DELIVERED) {
      return NextResponse.json({ error: 'Transaction must be shipped before claiming' }, { status: 400 });
    }

    const shippedTime = transaction.shipped_at ? new Date(transaction.shipped_at).getTime() : 0;
    const hoursSinceShipped = (Date.now() - shippedTime) / (1000 * 60 * 60);

    if (hoursSinceShipped < MARKETPLACE_CONSTANTS.AUTO_RELEASE_HOURS) {
      return NextResponse.json({ error: 'Delivery window has not elapsed yet' }, { status: 403 });
    }

    // Update status to COMPLETED
    const { error: updateError } = await supabaseAdmin
      .from('escrow_transactions')
      .update({
        status: EscrowStatus.COMPLETED,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', transactionId);

    if (updateError) {
      console.error('Error completing transaction:', updateError);
      return NextResponse.json({ error: 'Failed to update transaction' }, { status: 500 });
    }

    // Trigger auto payout 
    try {
      await PayoutService.initiateAutoPayout(transactionId);
    } catch (payoutError) {
      console.error('Payout initiation failed during manual claim:', payoutError);
      // Even if it fails, the transaction is marked completed. Cron job or manual retry handles failures.
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Claim transaction error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
