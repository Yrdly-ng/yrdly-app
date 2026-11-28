import { supabaseAdmin } from '@/lib/supabase/supabase-admin';
import { PaylukService } from '@/lib/payments/payluk-service';
import { paylukAmountsMatch } from '@/lib/payments/payment-state';
import { bookShipbubbleDelivery, deliveryOperationsEnabled, readDeliveryQuote, shipbubbleQuoteConfig } from './shipbubble-quote';

export async function dispatchDelivery(id: string, sellerId: string) {
  const config = shipbubbleQuoteConfig();
  if (!deliveryOperationsEnabled(config)) return { status: 404, error: 'Courier booking is unavailable.' };

  const { data: tx, error } = await supabaseAdmin.from('escrow_transactions')
    .select('id,buyer_id,seller_id,item_id,status,amount,metadata,delivery_details,payluk_escrow_id,payluk_tx_ref')
    .eq('id', id).eq('seller_id', sellerId).maybeSingle();
  if (error) return { status: 503, error: 'Could not load delivery order.' };
  if (!tx || tx.delivery_details?.option !== 'shipbubble') return { status: 404, error: 'Delivery order not found.' };
  const details = tx.delivery_details;
  if (details.shipment_id) return { status: 200 };
  if (tx.status !== 'paid' || details.delivery_status !== 'awaiting_seller' ||
    !tx.payluk_tx_ref || !tx.payluk_escrow_id) {
    return { status: 409, error: 'Delivery needs a confirmed payment or support review.' };
  }
  const quote = typeof details.quote === 'string' ? readDeliveryQuote(config, details.quote) : null;
  if (!quote || quote.buyerId !== tx.buyer_id || quote.itemId !== tx.item_id ||
    quote.feeKobo !== tx.metadata?.delivery_fee_kobo) {
    return { status: 409, error: 'The delivery quote requires support review.' };
  }

  try {
    const payment = await PaylukService.verifyEscrow(tx.payluk_tx_ref);
    if (payment.id !== tx.payluk_escrow_id || payment.status !== 'ONGOING' || !paylukAmountsMatch(tx, payment)) {
      return { status: 409, error: 'Delivery needs a verified Payluk payment.' };
    }
  } catch {
    return { status: 503, error: 'Could not verify Payluk payment before dispatch.' };
  }

  const base = supabaseAdmin.from('escrow_transactions');
  const claim = await base.update({ delivery_details: { ...details, delivery_status: 'booking' } })
    .eq('id', id).eq('status', 'paid').eq('delivery_details->>delivery_status', 'awaiting_seller').select('id').maybeSingle();
  if (claim.error) return { status: 503, error: 'Could not reserve the courier booking.' };
  if (!claim.data) return { status: 409, error: 'A booking is already underway or the order changed.' };

  try {
    const booked = await bookShipbubbleDelivery(config, quote);
    const updated = await base.update({ delivery_details: {
      option: 'shipbubble', quote_id: details.quote_id, delivery_status: 'pending', shipment_id: booked.shipmentId, tracking_url: booked.trackingUrl,
    } }).eq('id', id).eq('delivery_details->>delivery_status', 'booking').select('id').maybeSingle();
    if (updated.error || !updated.data) throw new Error('Booking reference could not be saved');
    return { status: 200 };
  } catch {
    // The provider could have committed the shipment even if our request timed out.
    // Keep the booking locked until support reconciles the shipment.
    await base.update({ delivery_details: { ...details, delivery_status: 'needs_review' } })
      .eq('id', id).eq('delivery_details->>delivery_status', 'booking');
    return { status: 502, error: 'Courier booking needs support review before another attempt.' };
  }
}
