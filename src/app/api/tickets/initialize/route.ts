import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from "@/lib/supabase-server";
import { supabaseAdmin } from '@/lib/supabase-admin';
import { PaylukService } from '@/lib/payluk-service';
import { getPaylukCustomerId } from '@/lib/payluk-onboarding';
import { EscrowStatus } from '@/types/escrow';

/**
 * POST /api/tickets/initialize
 * Initiates a Payluk Escrow checkout for ticket purchase.
 * Returns paylukPaymentToken & paymentLink.
 */
export async function POST(request: NextRequest) {
  try {
    // ── Auth ──────────────────────────────────────────────
    const { data: { user }, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });

    const body = await request.json();
    const { eventId, tierId, attendeeName, attendeeEmail, attendeePhone } = body;

    if (!eventId || !tierId || !attendeeName || !attendeeEmail) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // ── Fetch event + tier ────────────────────────────────
    const { data: tier } = await supabaseAdmin
      .from('ticket_tiers')
      .select('*, event:events(id, title, status, payout_mode, payment_subaccount_id, organizer_id, end_time)')
      .eq('id', tierId)
      .single();

    if (!tier || !tier.event) {
      return NextResponse.json({ error: 'Tier not found' }, { status: 404 });
    }
    if (tier.event.id !== eventId) {
      return NextResponse.json({ error: 'Tier does not belong to this event' }, { status: 400 });
    }
    if (tier.event.status !== 'PUBLISHED') {
      return NextResponse.json({ error: 'Event is not available for purchase' }, { status: 400 });
    }
    const MAX_TICKETS_PER_TIER = 5;
    const { data: existingUserTickets } = await supabaseAdmin
      .from('tickets')
      .select('id')
      .eq('buyer_id', user.id)
      .eq('tier_id', tierId)
      .neq('status', 'CANCELLED');

    const userOwnedCount = existingUserTickets?.length || 0;
    if (userOwnedCount + 1 > MAX_TICKETS_PER_TIER) {
      return NextResponse.json({
        error: 'MAX_TICKET_LIMIT_EXCEEDED',
        message: `You have reached the maximum limit of ${MAX_TICKETS_PER_TIER} tickets for this tier.`,
      }, { status: 400 });
    }

    if (tier.capacity != null && tier.sold >= tier.capacity) {
      return NextResponse.json({ error: 'This ticket tier is sold out' }, { status: 409 });
    }

    // ── Build tx_ref carrying all data for webhook ────────
    const txRef = `evt-tkt-${tierId.substring(0,6)}-${user.id.substring(0,4)}-${Date.now()}`;
    const price = Number(tier.price);

    // ── Free ticket — skip Payluk ────────────────────
    if (price === 0) {
      const { data: ticketId, error: rpcErr } = await supabaseAdmin.rpc('purchase_ticket', {
        p_tier_id: tierId,
        p_buyer_id: user.id,
        p_event_id: eventId,
        p_attendee_name: attendeeName,
        p_attendee_email: attendeeEmail,
        p_attendee_phone: attendeePhone || null,
        p_amount_paid: 0,
        p_tx_ref: txRef,
        p_flw_ref: null,
      });

      if (rpcErr) {
        if (rpcErr.message?.includes('TICKET_SOLD_OUT')) {
          return NextResponse.json({ error: 'Sold out' }, { status: 409 });
        }
        throw rpcErr;
      }

      return NextResponse.json({ success: true, free: true, ticketId });
    }

    // ── Paid ticket — initialise Payluk Escrow ──────────────────────────
    let buyerPaylukId: string;
    let organizerPaylukId: string;
    try {
      buyerPaylukId = await getPaylukCustomerId(user.id);
      organizerPaylukId = await getPaylukCustomerId(tier.event.organizer_id);
    } catch (onboardingErr: any) {
      console.error('[TicketInit] Payluk onboarding error:', onboardingErr);
      return NextResponse.json({
        error: onboardingErr?.message || 'Failed to prepare user payment account.',
      }, { status: 400 });
    }

    try {
      await PaylukService.updateCustomerPermissions(buyerPaylukId, { canBuy: true });
    } catch (e) {}
    try {
      await PaylukService.updateCustomerPermissions(organizerPaylukId, { canSell: true });
    } catch (e) {}

    let maxDelivery = 7;
    if (tier.event.end_time) {
      const msUntilEnd = new Date(tier.event.end_time).getTime() - Date.now();
      const days = Math.ceil(msUntilEnd / (1000 * 60 * 60 * 24));
      maxDelivery = Math.max(1, Math.min(days + 1, 90));
    }

    let paylukEscrow;
    try {
      paylukEscrow = await PaylukService.createEscrow(organizerPaylukId, {
        amount: price,
        purpose: `Ticket — ${tier.event.title}`,
        whoPays: 'seller',
        maxDelivery,
        deliveryTimeline: 'days',
        totalQuantity: 1,
      });
    } catch (paylukError: any) {
      console.error('[TicketInit] Payluk createEscrow error:', paylukError);
      return NextResponse.json({ error: 'Payment initialization failed', details: paylukError?.message }, { status: 502 });
    }

    const transactionId = crypto.randomUUID();
    const commission = Math.round(price * 0.05 * 100) / 100;
    const sellerAmount = price - commission;

    const { error: dbInsertErr } = await supabaseAdmin
      .from('escrow_transactions')
      .insert({
        id: transactionId,
        buyer_id: user.id,
        seller_id: tier.event.organizer_id,
        amount: price,
        commission,
        total_amount: price,
        seller_amount: sellerAmount,
        status: EscrowStatus.PENDING,
        payment_method: 'card',
        delivery_details: { option: 'event_entry' },
        payment_provider: 'payluk',
        payment_reference: txRef,
        payluk_tx_ref: paylukEscrow.paymentToken,
        payluk_escrow_id: paylukEscrow.id,
        item_type: 'ticket',
        item_id: tierId,
        metadata: {
          event_id: eventId,
          tier_id: tierId,
          quantity: 1,
          buyer_id: user.id,
          attendee_name: attendeeName,
          attendee_email: attendeeEmail,
          attendee_phone: attendeePhone || null,
        },
      });

    if (dbInsertErr) {
      console.error('[TicketInit] Failed to store escrow_transactions row:', dbInsertErr);
      return NextResponse.json({
        error: 'Failed to store payment record',
        details: dbInsertErr.message,
      }, { status: 500 });
    }

    const isLive = process.env.PAYLUK_SECRET_KEY?.startsWith('sk_live_');
    const paylukHost = isLive ? 'https://payluk.ng' : 'https://staging.api.payluk.ng';
    const paymentLink = `${paylukHost}/escrow/${paylukEscrow.paymentToken}`;

    return NextResponse.json({
      success: true,
      paymentLink,
      paylukPaymentToken: paylukEscrow.paymentToken,
      paylukEscrowId: paylukEscrow.id,
      buyerPaylukId,
      txRef,
    });
  } catch (error) {
    console.error('Ticket initialize error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

