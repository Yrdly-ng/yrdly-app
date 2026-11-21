import { supabaseAdmin } from '@/lib/supabase/supabase-admin';
import { readTravoQuote, sendTravoDeliveryQuote, travoCheckoutEnabled, travoSettings } from './travo-delivery';

export async function prepareTravoHandoff(transactionId: string, sellerId: string) {
  const settings = travoSettings();
  if (!settings) return { status: 503, error: 'Delivery setup is temporarily unavailable.' };
  const table = supabaseAdmin.from('escrow_transactions');
  const order = await table.select('id,item_id,buyer_id,status,delivery_details')
    .eq('id', transactionId).eq('seller_id', sellerId).maybeSingle();
  if (order.error) return { status: 503, error: 'Could not load the delivery order.' };
  const tx = order.data;
  if (!tx || tx.delivery_details?.option !== 'travo') return { status: 404, error: 'Delivery order not found.' };
  if (tx.delivery_details.provider_order_id) return { status: 200 };
  if (!travoCheckoutEnabled()) return { status: 503, error: 'Delivery setup is temporarily unavailable.' };
  if (tx.status !== 'paid' || tx.delivery_details.delivery_status !== 'awaiting_seller') {
    return { status: 409, error: 'Wait for the item payment to be confirmed.' };
  }
  const quote = readTravoQuote(settings, tx.delivery_details.quote);
  if (!quote || quote.buyerId !== tx.buyer_id || quote.itemId !== tx.item_id || quote.itemId !== settings.listingId || quote.expiresAt <= Date.now()) {
    return { status: 409, error: 'The delivery quote expired or could not be verified. Contact YRDLY support to arrange the handoff.' };
  }
  const profile = await supabaseAdmin.from('users').select('name,email,phone,phone_verified').eq('id', tx.buyer_id).maybeSingle();
  const buyer = profile.data;
  if (profile.error) return { status: 503, error: 'Could not load the buyer contact details.' };
  if (!buyer?.name || !buyer.email || !buyer.phone || !buyer.phone_verified) {
    return { status: 409, error: 'The buyer needs a name, email and verified phone for delivery.' };
  }

  try {
    // Travo retries for the same quote return the original order rather than dispatching twice.
    const provider = await sendTravoDeliveryQuote(settings, quote, transactionId, { name: buyer.name, email: buyer.email, phone: buyer.phone });
    const details = {
      option: 'travo', quote_id: quote.quoteId, fee_kobo: quote.feeKobo, expires_at: quote.expiresAt,
      provider_order_id: provider.orderId, payment_url: provider.paymentUrl, tracking_url: provider.trackingUrl,
      delivery_status: 'payment_link_issued',
    };
    const saved = await table.update({ delivery_details: details, updated_at: new Date().toISOString() })
      .eq('id', tx.id).eq('status', 'paid').eq('delivery_details->>delivery_status', 'awaiting_seller').select('id').maybeSingle();
    if (saved.error || !saved.data) {
      const current = await table.select('delivery_details').eq('id', tx.id).maybeSingle();
      if (current.data?.delivery_details?.provider_order_id !== provider.orderId) {
        return { status: 409, error: 'The order changed while creating the delivery link. Contact support before sending the parcel.' };
      }
    }
    return { status: 200 };
  } catch {
    return { status: 503, error: 'Travo could not prepare the delivery payment. Try again from this order or contact support.' };
  }
}
