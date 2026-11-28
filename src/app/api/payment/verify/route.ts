import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/supabase-admin';
import { getAuthenticatedUser } from '@/lib/supabase/supabase-server';
import { PaylukService } from '@/lib/payments/payluk-service';
import { applyEscrowPayment } from '@/lib/payments/escrow-payment';
import { flagPayment } from '@/lib/payments/payment-reconciliation';
import { paylukAmountsMatch } from '@/lib/payments/payment-state';

// Measurement uses the provider-confirmed principal, not a client quote or fee-inclusive total.
function marketplaceMeasurement(tx: {
  item_type: string; amount: number | string; commission?: number | string | null;
  metadata?: { payluk_fee_mode?: string; payluk_environment?: unknown; event_id?: unknown } | null;
  payluk_escrow_id?: string | null;
}, remote: Awaited<ReturnType<typeof PaylukService.verifyEscrow>>) {
  if ((tx.item_type !== 'post' && tx.item_type !== 'catalog_item') ||
      process.env.QA_ENVIRONMENT === 'staging' ||
      !['https://yoiyqxtpmxnrrbqqidcs.supabase.co', 'https://api.yrdly.ng'].includes(process.env.NEXT_PUBLIC_SUPABASE_URL || '') ||
      remote.environment !== 'live' ||
      (tx.metadata?.payluk_environment != null && tx.metadata.payluk_environment !== 'live') ||
      !tx.payluk_escrow_id || remote.id !== tx.payluk_escrow_id ||
      !['ONGOING','COMPLETED','CLAIMED'].includes((remote.status || '').toUpperCase()) ||
      !paylukAmountsMatch(tx, remote)) return {};
  return { measurementAmount: Number(tx.amount), measurementKind: tx.item_type };
}

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
    if (tx.payment_provider !== 'payluk') return NextResponse.json({ error:'Payment provider requires support reconciliation' },{ status:409 });
    if (['paid','shipped','delivered','completed'].includes(tx.status)) {
      let measurement = {};
      // An older paid row alone cannot prove which provider environment funded it.
      // Optional analytics evidence must not break already-paid recovery.
      if (process.env.NEXT_PUBLIC_YRDLY_GOOGLE_MEASUREMENT === 'gtm' &&
          ['post','catalog_item'].includes(tx.item_type) && tx.payluk_tx_ref) {
        try { measurement = marketplaceMeasurement(tx, await PaylukService.verifyEscrow(tx.payluk_tx_ref)); }
        catch { /* Payment is already confirmed in the ledger. */ }
      }
      return NextResponse.json({ success:true,transactionId:tx.id,amount:tx.total_amount,...measurement });
    }
    if (!tx.payluk_tx_ref) return NextResponse.json({ error:'Payment setup incomplete' },{ status:409 });
    const remote = await PaylukService.verifyEscrow(tx.payluk_tx_ref);
    if (!['ONGOING','COMPLETED','CLAIMED'].includes((remote.status || '').toUpperCase())) return NextResponse.json({ error:'Payment not completed' },{ status:402 });
    if (!paylukAmountsMatch(tx, remote) ||
      (tx.metadata?.payluk_fee_mode === 'native_commission_delivery_v1' && remote.id !== tx.payluk_escrow_id)) {
      await flagPayment('payluk',txRef,tx.id,'amount_mismatch');
      return NextResponse.json({ error:'Payment requires reconciliation' },{ status:409 });
    }
    await applyEscrowPayment(tx.id,'payluk',tx.payluk_escrow_id || txRef);
    return NextResponse.json({ success:true,transactionId:tx.id,amount:tx.total_amount,...marketplaceMeasurement(tx, remote) });
  } catch (error) {
    console.error('[PaymentVerify] Verification failed:',error);
    return NextResponse.json({ error:'Payment could not be confirmed. Please retry or contact support.' },{ status:503 });
  }
}
