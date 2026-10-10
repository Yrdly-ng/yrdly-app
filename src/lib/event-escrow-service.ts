/**
 * Event Escrow Service — mirrors escrow-service.ts for event transactions.
 * Handles ticket purchase escrow using event_payouts table.
 * Server-side only.
 */

import { createClient } from '@supabase/supabase-js';
import { PaylukService } from './payluk-service';
import { getPaylukCustomerId } from './payluk-onboarding';
import { EVENT_CONSTANTS } from './constants';

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
  static async getOrganizerBankDetails(organizerId: string): Promise<{ bankCode: string; accountNumber: string; accountName?: string; updatedAt: string } | null> {
    const { data, error } = await adminSupabase
      .from('seller_accounts')
      .select('account_details, account_type, updated_at')
      .eq('user_id', organizerId)
      .eq('is_primary', true)
      .eq('is_active', true)
      .eq('verification_status', 'verified')
      .single();

    if (error || !data) return null;

    const accountDetails = data.account_details as Record<string, string> | null;
    const bankCode = accountDetails?.bank_code || accountDetails?.bankCode;
    const accountNumber = accountDetails?.account_number || accountDetails?.accountNumber;
    const accountName = accountDetails?.account_name || accountDetails?.accountName || 'Organizer';

    if (!bankCode || !accountNumber) return null;
    return { bankCode, accountNumber, accountName, updatedAt: data.updated_at };
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
      .select('id, organizer_id, title')
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
    const { data: tickets, error: ticketsError } = await adminSupabase.from('tickets')
      .select('amount_paid,payment_provider,settlement_mode').eq('event_id', eventId)
      .in('status', ['PAID', 'USED']).is('refund_status', null);
    if (ticketsError) throw ticketsError;
    if (!tickets?.length) return;
    if (tickets.some(ticket => Number(ticket.amount_paid) > 0 && (!ticket.settlement_mode || ticket.settlement_mode === 'unknown'))) {
      throw new Error('Legacy ticket settlement needs reconciliation before payout.');
    }
    const held = tickets.filter(ticket => ticket.settlement_mode === 'held' && Number(ticket.amount_paid) > 0);
    if (!held.length) return; // Free tickets and split-settled revenue require no outbound transfer.
    const providers = new Set(held.map(ticket => ticket.payment_provider));
    if (providers.size !== 1 || held[0].payment_provider !== 'payluk') {
      throw new Error('Mixed or unknown payment providers require payout reconciliation.');
    }
    const provider = held[0].payment_provider;
    const gross = held.reduce((sum, ticket) => sum + Number(ticket.amount_paid), 0);
    const { commission, net } = this.calculateAmounts(gross);
    const bank = await this.getOrganizerBankDetails(organizerId);
    if (!bank) throw new Error('Organizer has no verified payout account');
    if (bank.updatedAt && Date.now() - Date.parse(bank.updatedAt) < 86400000) return;
    const { data: existing, error: existingError } = await adminSupabase.from('event_payouts').select('*').eq('event_id', eventId).maybeSingle();
    if (existingError) throw existingError;
    let payout = existing;
    let outcome: 'success' | 'pending' | 'failed' = 'pending';
    if (payout) {
      if (payout.status === 'COMPLETED') return;
      if (payout.status !== 'PROCESSING' || !payout.payment_transfer_id || payout.payment_provider !== 'payluk') {
        throw new Error('Existing payout requires reconciliation; no new transfer was attempted.');
      }
      outcome = await PaylukService.getWithdrawalStatus(await getPaylukCustomerId(organizerId), payout.payment_transfer_id);
    } else {
      const { data: created, error: createError } = await adminSupabase.from('event_payouts').insert({
        event_id: eventId, organizer_id: organizerId, gross_amount: gross, commission_amount: commission,
        net_amount: net, status: 'PROCESSING', payment_provider: provider,
      }).select('id').single();
      if (createError?.code === '23505') return;
      if (createError || !created) throw createError || new Error('Could not reserve event payout');
      payout = created;
      const reference = `event-payout-${payout.id}`;
      const { error: referenceError } = await adminSupabase.from('event_payouts')
        .update({ payment_transfer_id: reference }).eq('id', payout.id).eq('status', 'PROCESSING');
      if (referenceError) throw referenceError;
      const result = await PaylukService.withdrawToBank({
        sellerPaylukCustomerId: await getPaylukCustomerId(organizerId), amount: net,
        bankCode: bank.bankCode, accountNumber: bank.accountNumber, accountName: bank.accountName, reference,
        onIntentReady: async intentReference => {
          const { error } = await adminSupabase.from('event_payouts').update({ payment_transfer_id: intentReference }).eq('id', payout.id).eq('status', 'PROCESSING');
          if (error) throw error;
        },
      });
      outcome = result.outcome;
    }
    const { data:finalized,error: finalizeError } = await adminSupabase.from('event_payouts').update({
      status: outcome === 'success' ? 'COMPLETED' : outcome === 'failed' ? 'FAILED' : 'PROCESSING',
      ...(outcome === 'success' ? { paid_at: new Date().toISOString() } : { failure_reason: `Transfer ${outcome}; reconcile by stored reference.` }),
    }).eq('id', payout.id).eq('status', 'PROCESSING').select('id');
    if (finalizeError || !finalized?.length) throw finalizeError || new Error('Payout state changed; reconciliation required');
    if (outcome === 'success') {
      const { error } = await adminSupabase.from('events').update({ payout_released_at: new Date().toISOString() }).eq('id', eventId);
      if (error) throw error;
    } else {
      throw new Error(`Event payout ${outcome}; no additional transfer was attempted.`);
    }
  }


}
