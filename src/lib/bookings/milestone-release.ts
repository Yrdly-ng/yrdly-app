import 'server-only';
import { supabaseAdmin } from '../supabase/supabase-admin';
import { PaylukService } from '../payments/payluk-service';
import { getPaylukCustomerId } from '../payments/payluk-onboarding';
import { stagedBookingOperationsEnabled, stagedBookingEnvironment } from './staged-booking-config';
import { verifyBookingMilestoneContract } from './milestone-contract';
import { BookingCheckoutError } from './booking-payments';

/** A lost confirmation response is read-only recovery; never blindly confirm twice. */
export async function approveBookingMilestone(bookingId: string, buyer: string, position: 1 | 2) {
  if (!stagedBookingOperationsEnabled()) throw new BookingCheckoutError('Staged service payments are awaiting activation.', 503);
  const { data: authorized, error } = await supabaseAdmin.rpc('authorize_booking_milestone_release', {
    p_booking: bookingId, p_buyer: buyer, p_position: position,
  });
  if (error || !authorized?.release) throw new BookingCheckoutError('This booking milestone cannot be approved yet.');
  const release = authorized.release;
  const rows = await supabaseAdmin.from('booking_milestone_releases').select('*').eq('transaction_id', release.transaction_id).order('position');
  if (rows.error || rows.data?.length !== 2) throw new BookingCheckoutError('Milestone records require review.');
  const tx = await supabaseAdmin.from('escrow_transactions').select('payluk_tx_ref,payluk_escrow_id,amount,metadata').eq('id', release.transaction_id).single();
  if (tx.error || !tx.data?.payluk_tx_ref || tx.data.payluk_escrow_id !== release.escrow_id) throw new BookingCheckoutError('Payment records require review.');
  if(tx.data.metadata?.payluk_environment!==stagedBookingEnvironment())throw new BookingCheckoutError('Booking payment environment requires review.');
  const expected = rows.data.map(r => ({ id: r.milestone_id, amount: Number(r.amount_kobo) / 100 }));
  let milestones = await PaylukService.getMilestones(tx.data.payluk_tx_ref);
  verifyBookingMilestoneContract(milestones, expected);
  let remote = milestones.find(m => m.id === release.milestone_id)!;
  if (authorized.submit && remote.status === 'PENDING') {
    const escrow = await PaylukService.verifyEscrow(tx.data.payluk_tx_ref);
    if ((escrow as unknown as {environment:string}).environment !== stagedBookingEnvironment() || escrow.id !== release.escrow_id || escrow.state !== 'OPENED' || escrow.status !== 'ONGOING' ||
      escrow.settlementType !== 'MILESTONE' || escrow.whoPays !== 'buyer' || Number(escrow.additionalFee || 0) !== 0 ||
      Math.round(escrow.amount * 100) !== Math.round(Number(tx.data.amount) * 100)) {
      throw new BookingCheckoutError('The provider payment is on hold or requires review.');
    }
    const customer = await getPaylukCustomerId(buyer);
    // Preflight failures are safe to retry. Once this durable claim is made, an
    // unknown provider outcome is reconciled by reads, never another confirmation.
    const submission = await supabaseAdmin.rpc('claim_booking_milestone_submission', {
      p_release: release.id, p_buyer: buyer,
    });
    if (submission.error) throw new BookingCheckoutError('Release authorization changed. Refresh the booking before trying again.', 503);
    if (submission.data === true) {
      await PaylukService.confirmMilestone(customer, release.escrow_id, release.milestone_id);
    }
    milestones = await PaylukService.getMilestones(tx.data.payluk_tx_ref);
    verifyBookingMilestoneContract(milestones, expected);
    remote = milestones.find(m => m.id === release.milestone_id)!;
  }
  if (remote.status !== 'RELEASED' || !remote.releasedAt) {
    return { status: 'reconciling', message: 'Release is being checked. No further release was submitted.' };
  }
  const numeric = Number(remote.releasedAt);
  const releasedAt = Number.isFinite(numeric) && numeric > 0 ? new Date(numeric < 1e12 ? numeric * 1000 : numeric) : new Date(remote.releasedAt);
  if (!Number.isFinite(releasedAt.getTime())) throw new BookingCheckoutError('Provider release time requires review.');
  const saved = await supabaseAdmin.rpc('record_booking_milestone_release', {
    p_release: release.id, p_escrow: release.escrow_id, p_milestone: remote.id,
    p_amount: Math.round(remote.amount * 100), p_released_at: releasedAt.toISOString(),
  });
  if (saved.error) throw new BookingCheckoutError('Provider release requires reconciliation. Do not approve another payment.', 503);
  return { status: 'released', position, amount: Number(release.amount_kobo) / 100 };
}
