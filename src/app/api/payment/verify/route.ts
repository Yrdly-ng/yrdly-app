import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthenticatedUser } from '@/lib/supabase-server';
import { PaystackService } from '@/lib/paystack-service';
import { PaylukService } from '@/lib/payluk-service';
import { applyEscrowPayment } from '@/lib/escrow-payment';
import { flagPayment } from '@/lib/payment-reconciliation';

export async function POST(request: NextRequest) {
  try {
    const { data:{ user },error:authError } = await getAuthenticatedUser(request);
    if (authError || !user) return NextResponse.json({ error:'Invalid session' },{ status:authError?.status === 403 ? 403 : authError?.status === 503 ? 503 : 401 });
    const { txRef } = await request.json();
    if (typeof txRef !== 'string' || !/^[0-9a-f-]{36}$/i.test(txRef)) return NextResponse.json({ error:'Invalid reference' },{ status:400 });
    const { data:tx,error } = await supabaseAdmin.from('escrow_transactions').select('*').eq('id',txRef).maybeSingle();
    if (error) throw error;
    if (!tx) return NextResponse.json({ error:'Transaction not found' },{ status:404 });
    if (tx.buyer_id !== user.id) return NextResponse.json({ error:'Forbidden' },{ status:403 });
    if (['paid','shipped','delivered','completed'].includes(tx.status)) return NextResponse.json({ success:true,transactionId:tx.id,amount:tx.total_amount });
    const provider = tx.payment_provider === 'payluk' || tx.payluk_escrow_id ? 'payluk' : 'paystack';
    if (provider === 'payluk') {
      if (!tx.payluk_escrow_id) return NextResponse.json({ error:'Payment setup incomplete' },{ status:409 });
      const remote = await PaylukService.verifyEscrow(tx.payluk_escrow_id);
      if (!['ONGOING','COMPLETED','CLAIMED'].includes((remote.status || '').toUpperCase())) return NextResponse.json({ error:'Payment not completed' },{ status:402 });
    } else {
      const verified = await PaystackService.verifyPayment(txRef);
      if (!verified.success || verified.status !== 'success') return NextResponse.json({ error:'Payment not completed' },{ status:402 });
      if (Math.round(Number(verified.amount)*100) !== Math.round(Number(tx.total_amount)*100)) {
        await flagPayment(provider,txRef,tx.id,'amount_mismatch');
        return NextResponse.json({ error:'Payment requires reconciliation' },{ status:409 });
      }
    }
    await applyEscrowPayment(tx.id,provider,tx.payluk_escrow_id || txRef);
    return NextResponse.json({ success:true,transactionId:tx.id,amount:tx.total_amount });
  } catch (error) {
    console.error('[PaymentVerify] Verification failed:',error);
    return NextResponse.json({ error:'Payment could not be confirmed. Please retry or contact support.' },{ status:503 });
  }
}
