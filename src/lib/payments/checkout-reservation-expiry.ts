import { supabaseAdmin } from '@/lib/supabase/supabase-admin';
import { PaylukService } from './payluk-service';
import { getPaylukCustomerId } from './payluk-onboarding';
import { applyEscrowPayment } from './escrow-payment';
import { flagPayment } from './payment-reconciliation';

export const CHECKOUT_RESERVATION_TTL_MS = 10 * 60 * 1000;
export const RESERVATION_SELECT = 'id,buyer_id,seller_id,item_type,status,payluk_tx_ref,payluk_escrow_id,total_amount,creating_escrow_started_at,created_at,updated_at';

type Reservation = {
  id: string;
  seller_id: string;
  status: string;
  created_at: string;
  payluk_tx_ref: string | null;
  payluk_escrow_id: string | null;
};

export function reservationHasExpired(reservation: Pick<Reservation, 'created_at'>): boolean {
  return Date.now() - Date.parse(reservation.created_at) >= CHECKOUT_RESERVATION_TTL_MS;
}

/** Never release local stock while an old provider checkout can still be paid. */
export async function expireCheckoutReservation(reservation: Reservation): Promise<boolean> {
  if (!reservationHasExpired(reservation) || !['pending', 'creating_escrow', 'reconciling'].includes(reservation.status)) return false;
  let providerInvalidated = false;
  if (reservation.payluk_escrow_id || reservation.payluk_tx_ref) {
    if (!reservation.payluk_escrow_id || !reservation.payluk_tx_ref) return false;
    try {
      const remote = await PaylukService.verifyEscrow(reservation.payluk_tx_ref);
      if (['ONGOING', 'COMPLETED', 'CLAIMED'].includes((remote.status || '').toUpperCase())) {
        await applyEscrowPayment(reservation.id, 'payluk', reservation.payluk_escrow_id);
        return false;
      }
      if (remote.status !== 'PENDING' || remote.state !== 'AWAITING_PAYMENT') return false;
      const seller = await getPaylukCustomerId(reservation.seller_id);
      // Payluk only permits deletion while unpaid, closing the verify/payment race.
      await PaylukService.deleteEscrow(seller, reservation.payluk_tx_ref);
      providerInvalidated = true;
    } catch {
      await flagPayment('payluk', reservation.payluk_escrow_id, reservation.id, 'checkout_expiry_requires_review');
      return false;
    }
  } else if (reservation.status !== 'pending') {
    // A creation timeout can hide an existing provider escrow; retain its lock.
    return false;
  }
  const { data, error } = await supabaseAdmin.rpc('expire_checkout_reservation', {
    p_transaction_id: reservation.id,
    p_expected_escrow_id: reservation.payluk_escrow_id,
    p_expected_token: reservation.payluk_tx_ref,
    p_provider_invalidated: providerInvalidated,
  });
  if (error) throw error;
  return data === true;
}

export async function expireItemCheckoutReservations(itemId: string, itemType: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.from('escrow_transactions')
    .select(RESERVATION_SELECT).eq('item_id', itemId).eq('item_type', itemType)
    .in('status', ['pending', 'creating_escrow', 'reconciling'])
    .lte('created_at', new Date(Date.now() - CHECKOUT_RESERVATION_TTL_MS).toISOString())
    .order('created_at', { ascending: true }).limit(2);
  if (error) throw error;
  let expired = false;
  for (const reservation of data || []) expired = await expireCheckoutReservation(reservation) || expired;
  return expired;
}
