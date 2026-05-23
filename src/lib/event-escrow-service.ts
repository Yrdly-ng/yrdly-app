/**
 * Event Escrow Service — mirrors escrow-service.ts for event transactions.
 * Handles ticket purchase escrow using event_payouts table.
 * Server-side only.
 */

import { createClient } from '@supabase/supabase-js';
import { FlutterwaveService } from './flutterwave-service';
import { EVENT_CONSTANTS } from './constants';
import type { EventPayout } from '@/types/events';

// Service-role client for writes that bypass RLS
const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy_key'
);

export class EventEscrowService {
  /**
   * Calculate amounts for a ticket purchase
   */
  static calculateAmounts(ticketPrice: number) {
    const commission = Math.round(ticketPrice * EVENT_CONSTANTS.COMMISSION_RATE * 100) / 100;
    const net = Math.round((ticketPrice - commission) * 100) / 100;
    return { gross: ticketPrice, commission, net };
  }

  /**
   * Get the organizer's bank details for outbound transfers
   */
  static async getOrganizerBankDetails(organizerId: string): Promise<{ bankCode: string; accountNumber: string } | null> {
    const { data, error } = await adminSupabase
      .from('seller_accounts')
      .select('account_details, account_type')
      .eq('user_id', organizerId)
      .eq('is_primary', true)
      .eq('is_active', true)
      .eq('verification_status', 'verified')
      .single();

    if (error || !data) return null;

    const accountDetails = data.account_details as Record<string, string> | null;
    const bankCode = accountDetails?.bank_code || accountDetails?.bankCode;
    const accountNumber = accountDetails?.account_number || accountDetails?.accountNumber;

    if (!bankCode || !accountNumber) return null;
    return { bankCode, accountNumber };
  }

  /**
   * Check if an organizer has a verified payout account (required for paid events)
   */
  static async organizerCanReceivePayments(organizerId: string): Promise<boolean> {
    const details = await this.getOrganizerBankDetails(organizerId);
    return !!details;
  }

  /**
   * Process payouts for all events that ended > AUTO_RELEASE_HOURS ago
   * Called by the cron job
   */
  static async processMaturedPayouts(): Promise<{
    processed: number;
    failed: number;
    errors: string[];
  }> {
    const cutoff = new Date(
      Date.now() - EVENT_CONSTANTS.AUTO_RELEASE_HOURS * 60 * 60 * 1000
    ).toISOString();

    // Find completed events that ended before the cutoff with no payout yet
    const { data: events, error } = await adminSupabase
      .from('events')
      .select('id, organizer_id, flutterwave_subaccount_id, title')
      .eq('status', 'COMPLETED')
      .lt('end_time', cutoff)
      .is('payout_released_at', null);

    if (error || !events?.length) {
      return { processed: 0, failed: 0, errors: error ? [error.message] : [] };
    }

    let processed = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const event of events) {
      try {
        await this.processEventPayout(event.id, event.organizer_id);
        processed++;
      } catch (err) {
        failed++;
        errors.push(`Event ${event.id}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }

    return { processed, failed, errors };
  }

  /**
   * Process payout for a single completed event
   */
  static async processEventPayout(eventId: string, organizerId: string): Promise<void> {
    // Sum all PAID tickets for this event
    const { data: tickets, error: ticketsError } = await adminSupabase
      .from('tickets')
      .select('amount_paid')
      .eq('event_id', eventId)
      .eq('status', 'PAID');

    if (ticketsError) throw ticketsError;
    if (!tickets?.length) return; // No tickets sold — nothing to payout

    const gross = tickets.reduce((sum, t) => sum + Number(t.amount_paid), 0);
    const { commission, net } = this.calculateAmounts(gross);

    // Get organizer bank details for outbound transfer
    const bankDetails = await this.getOrganizerBankDetails(organizerId);
    if (!bankDetails) throw new Error('Organizer has no verified payout account');

    // Check for existing payout record to avoid double-processing
    const { data: existing } = await adminSupabase
      .from('event_payouts')
      .select('id, status')
      .eq('event_id', eventId)
      .in('status', ['PENDING', 'PROCESSING', 'COMPLETED'])
      .single();

    if (existing) return; // Already processed or in progress

    // Create payout record
    const { data: payout, error: payoutError } = await adminSupabase
      .from('event_payouts')
      .insert({
        event_id: eventId,
        organizer_id: organizerId,
        gross_amount: gross,
        commission_amount: commission,
        net_amount: net,
        status: 'PROCESSING',
      })
      .select('id')
      .single();

    if (payoutError || !payout) throw payoutError || new Error('Failed to create payout record');

    // Execute transfer via Flutterwave
    const transferSuccess = await FlutterwaveService.transferToSeller({
      bankCode: bankDetails.bankCode,
      accountNumber: bankDetails.accountNumber,
      amount: net,
      reference: `event-payout-${payout.id}`,
      narration: `Event payout for event ${eventId}`,
    });

    const updatePayload = transferSuccess
      ? { status: 'COMPLETED', paid_at: new Date().toISOString() }
      : { status: 'FAILED', failure_reason: 'Flutterwave transfer failed' };

    await adminSupabase
      .from('event_payouts')
      .update(updatePayload)
      .eq('id', payout.id);

    // Mark event as payout released
    if (transferSuccess) {
      await adminSupabase
        .from('events')
        .update({ payout_released_at: new Date().toISOString() })
        .eq('id', eventId);
    }

    if (!transferSuccess) {
      throw new Error('Flutterwave transfer failed');
    }
  }

  static async processCancellationRefunds(eventId: string): Promise<{
    refunded: number;
    failed: number;
  }> {
    const { data: tickets, error } = await adminSupabase
      .from('tickets')
      .select('id, flutterwave_tx_ref, amount_paid, buyer_id')
      .eq('event_id', eventId)
      .eq('status', 'PAID');

    if (error || !tickets?.length) return { refunded: 0, failed: 0 };

    let refunded = 0;
    let failed = 0;

    for (const ticket of tickets) {
      try {
        if (ticket.amount_paid > 0 && ticket.flutterwave_tx_ref) {
          // 1. Get the transaction ID from Flutterwave using tx_ref
          const verifyRes = await fetch(
            `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${ticket.flutterwave_tx_ref}`,
            { headers: { Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` } }
          );
          const verifyData = await verifyRes.json();
          
          if (verifyData.status === 'success' && verifyData.data?.id) {
            // 2. Issue the refund
            const refundRes = await fetch(`https://api.flutterwave.com/v3/transactions/${verifyData.data.id}/refund`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ amount: ticket.amount_paid })
            });
            const refundData = await refundRes.json();
            
            if (refundData.status !== 'success') {
              throw new Error(`Refund failed: ${refundData.message}`);
            }
          }
        }

        // Mark as refunded in DB
        await adminSupabase
          .from('tickets')
          .update({ status: 'REFUNDED' })
          .eq('id', ticket.id);
        refunded++;
      } catch (err) {
        console.error(`[Escrow] Failed to refund ticket ${ticket.id}`, err);
        failed++;
      }
    }

    return { refunded, failed };
  }
}
