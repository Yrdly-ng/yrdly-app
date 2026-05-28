import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { EscrowStatus } from '@/types/escrow';
import { PayoutService } from '@/lib/payout-service';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;
    const transactionId = resolvedParams.id;

    if (!transactionId) {
      return NextResponse.json(
        { error: 'Transaction ID is required' },
        { status: 400 }
      );
    }

    // Auth verification should be done via Authorization header in a production environment.
    // For now, we rely on the client sending a POST request to complete the transaction.
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 1. Get the transaction using admin client to bypass RLS for this specific secure flow
    const { data: transaction, error: fetchError } = await supabaseAdmin
      .from('escrow_transactions')
      .select('status, seller_amount, seller_id, buyer_id')
      .eq('id', transactionId)
      .single();

    if (fetchError || !transaction) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    // Only the buyer can complete the transaction
    if (transaction.buyer_id !== user.id) {
      return NextResponse.json({ error: 'Only the buyer can complete this transaction' }, { status: 403 });
    }

    if (transaction.status !== EscrowStatus.DELIVERED) {
      return NextResponse.json({ error: 'Transaction must be delivered before completion' }, { status: 400 });
    }

    // 2. Update transaction status
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
      return NextResponse.json({ error: 'Failed to complete transaction' }, { status: 500 });
    }

    // 3. Initiate payout to seller now that buyer has confirmed receipt
    try {
      await PayoutService.initiateAutoPayout(transactionId);
    } catch (payoutError) {
      console.error('Payout initiation failed after buyer confirmation:', payoutError);
      // Don't throw — transaction is still completed even if payout initiation fails
    }

    // 4. Send notification to seller about funds release
    try {
      const { data: txWithItem } = await supabaseAdmin
        .from('escrow_transactions')
        .select(`
          seller_id,
          seller_amount,
          item:posts(title, text)
        `)
        .eq('id', transactionId)
        .single();

      if (txWithItem) {
        const itemTitle = Array.isArray(txWithItem.item) 
          ? (txWithItem.item[0]?.title || txWithItem.item[0]?.text || 'Item')
          : ((txWithItem.item as any)?.title || (txWithItem.item as any)?.text || 'Item');

        // We can create notification via admin client too by inserting directly
        await supabaseAdmin.from('notifications').insert({
          user_id: txWithItem.seller_id,
          type: 'payout_processed',
          title: 'Funds Released',
          message: `Your payment of ₦${txWithItem.seller_amount.toLocaleString()} for "${itemTitle}" has been released and is on the way to your bank.`,
          data: { amount: txWithItem.seller_amount, itemTitle, transactionId }
        });
      }
    } catch (notificationError) {
      console.error('Failed to send funds release notification:', notificationError);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Complete transaction error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
