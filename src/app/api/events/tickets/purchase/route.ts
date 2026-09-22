import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAuthenticatedUser } from "@/lib/supabase-server";
import { supabaseAdmin } from '@/lib/supabase-admin';
import { EVENT_CONSTANTS } from '@/lib/constants';
import { ResendEmailService } from '@/lib/resend-service';
import QRCode from 'qrcode';
import { getPostHogClient } from '@/lib/posthog-server';
import { PaylukService } from '@/lib/payluk-service';
import { PaystackService } from '@/lib/paystack-service';
import { getPaylukCustomerId } from '@/lib/payluk-onboarding';
import { EscrowStatus } from '@/types/escrow';

/**
 * POST /api/events/tickets/purchase
 * Initialises a Payluk Escrow payment for a ticket.
 * Returns paylukPaymentToken & payment_link.
 */
export async function POST(request: NextRequest) {
  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const { data: { user }, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    const { event_id, tier_id, attendee_name, attendee_email, attendee_phone, callbackUrl, quantity: rawQuantity } = await request.json();
    const quantity = Math.max(1, parseInt(rawQuantity || '1', 10));

    if (!event_id || !tier_id || !attendee_name || !attendee_email) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // ── Validate event & tier ────────────────────────────────────────────────
    const { data: event } = await supabaseAdmin
      .from('events')
      .select('id, title, status, organizer_id, payment_subaccount_id, end_time')
      .eq('id', event_id)
      .single();

    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    if (event.status !== 'PUBLISHED') return NextResponse.json({ error: 'Event is not available' }, { status: 400 });
    if (event.organizer_id === user.id) return NextResponse.json({ error: 'Organizers cannot purchase their own tickets' }, { status: 400 });

    const { data: tier } = await supabaseAdmin
      .from('ticket_tiers')
      .select('id, name, price, capacity, sold, is_visible, sale_ends_at')
      .eq('id', tier_id)
      .eq('event_id', event_id)
      .single();

    if (!tier) return NextResponse.json({ error: 'Ticket tier not found' }, { status: 404 });
    if (!tier.is_visible) return NextResponse.json({ error: 'This ticket tier is not available' }, { status: 400 });
    if (tier.sale_ends_at && new Date(tier.sale_ends_at) < new Date()) {
      return NextResponse.json({ error: 'Ticket sales have ended for this tier' }, { status: 400 });
    }

    const MAX_TICKETS_PER_TIER = 5;
    if (quantity > MAX_TICKETS_PER_TIER) {
      return NextResponse.json({ error: `You can only purchase a maximum of ${MAX_TICKETS_PER_TIER} tickets per tier.` }, { status: 400 });
    }

    const { data: existingUserTickets } = await supabaseAdmin
      .from('tickets')
      .select('id')
      .eq('buyer_id', user.id)
      .eq('tier_id', tier_id)
      .neq('status', 'CANCELLED');

    const userOwnedCount = existingUserTickets?.length || 0;
    if (userOwnedCount + quantity > MAX_TICKETS_PER_TIER) {
      const remainingAllowed = Math.max(0, MAX_TICKETS_PER_TIER - userOwnedCount);
      const message = userOwnedCount >= MAX_TICKETS_PER_TIER
        ? `You have reached the maximum limit of ${MAX_TICKETS_PER_TIER} tickets for this tier.`
        : `You already own ${userOwnedCount} ticket(s) for this tier. You can only buy up to ${remainingAllowed} more (max ${MAX_TICKETS_PER_TIER} per tier).`;
      return NextResponse.json({ error: 'MAX_TICKET_LIMIT_EXCEEDED', message }, { status: 400 });
    }

    if (tier.capacity !== null && (tier.sold + quantity) > tier.capacity) {
      return NextResponse.json({ error: 'SOLD_OUT', message: `Not enough tickets left. Only ${Math.max(0, tier.capacity - tier.sold)} available.` }, { status: 409 });
    }

    // ── Free ticket — create directly, no payment needed ────────────────────
    if (tier.price === 0) {
      const ticketsToInsert = [];
      
      for (let i = 0; i < quantity; i++) {
        const ticketCode = `${EVENT_CONSTANTS.TICKET_CODE_PREFIX}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
        const qrData = JSON.stringify({ ticket_code: ticketCode, event_id, tier_id });
        ticketsToInsert.push({
          buyer_id: user.id,
          event_id,
          tier_id,
          attendee_name,
          attendee_email,
          attendee_phone: attendee_phone || null,
          ticket_code: ticketCode,
          qr_data: qrData,
          status: 'PAID',
          amount_paid: 0,
          expires_at: event.end_time || null,
        });
      }

      const { data: insertedTickets, error: ticketError } = await supabaseAdmin
        .from('tickets')
        .insert(ticketsToInsert)
        .select('id, ticket_code, qr_data');

      if (ticketError) throw ticketError;

      // Increment sold count
      await supabaseAdmin
        .from('ticket_tiers')
        .update({ sold: tier.sold + quantity })
        .eq('id', tier_id);

      // Increment event attendee_count
      try {
        const { data: eData } = await supabaseAdmin.from('events').select('attendee_count').eq('id', event_id).single();
        if (eData) {
          await supabaseAdmin.from('events').update({ attendee_count: (eData.attendee_count || 0) + quantity }).eq('id', event_id);
        }
      } catch (e) {}

      // ── Send confirmation email to buyer ────────────────────────────────
      try {
        if (ResendEmailService.isConfigured()) {
          const { data: fullEvent } = await supabaseAdmin
            .from('events')
            .select('id, title, start_time, location_address, state, organizer_id')
            .eq('id', event_id)
            .single();

          if (fullEvent) {
            const startDate = new Date(fullEvent.start_time);
            
            for (const ticket of insertedTickets) {
              const qrDataUrl = await QRCode.toDataURL(ticket.qr_data, { width: 300, margin: 2 });
              await ResendEmailService.sendTicketConfirmationEmail(
                attendee_name,
                attendee_email,
                event.title,
                tier.name,
                ticket.id,
                qrDataUrl,
                startDate.toLocaleDateString('en-NG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
                startDate.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }),
                fullEvent.location_address || fullEvent.state || 'See event details',
                `FREE-${ticket.ticket_code}`
              );
            }

            // ── Send organizer notification ─────────────────────────────────
            try {
              const { data: organizer } = await supabaseAdmin
                .from('users')
                .select('email, username')
                .eq('id', fullEvent.organizer_id)
                .single();

              if (organizer?.email) {
                try {
                  const { data: paidTickets } = await supabaseAdmin
                    .from('tickets')
                    .select('amount_paid')
                    .eq('event_id', event_id)
                    .eq('status', 'PAID');

                  const totalSold = (paidTickets?.length || 0);
                  const grossRevenue = (paidTickets || []).reduce((sum, t) => sum + (t.amount_paid || 0), 0);
                  const netPayout = Math.round(grossRevenue * (1 - EVENT_CONSTANTS.COMMISSION_RATE) * 100) / 100;

                  await ResendEmailService.sendTicketSaleNotificationEmail(
                    organizer.email,
                    organizer.username || 'Event Organizer',
                    fullEvent.title,
                    attendee_name,
                    attendee_email,
                    `${quantity}x ${tier.name}`,
                    0,
                    insertedTickets[0].id,
                    event_id,
                    totalSold,
                    grossRevenue,
                    netPayout
                  );
                } catch (statsErr) {
                  await ResendEmailService.sendTicketSaleNotificationEmail(
                    organizer.email,
                    organizer.username || 'Event Organizer',
                    fullEvent.title,
                    attendee_name,
                    attendee_email,
                    `${quantity}x ${tier.name}`,
                    0,
                    insertedTickets[0].id
                  );
                }
              }
            } catch (orgErr) {}
          }
        }
      } catch (emailErr) {}

      const posthog = getPostHogClient();
      posthog.capture({
        distinctId: user.id,
        event: 'ticket_purchased',
        properties: {
          ticket_id: insertedTickets[0].id,
          event_id,
          tier_id,
          tier_name: tier.name,
          quantity,
          amount: 0,
          is_free: true,
        },
      });

      return NextResponse.json({ success: true, free: true, ticket_id: insertedTickets[0].id, quantity });
    }

    // ── Paid ticket — Check configured payment provider ────────────────────
    const provider = (process.env.NEXT_PUBLIC_PAYMENT_PROVIDER || process.env.PAYMENT_PROVIDER || 'payluk').toLowerCase();
    const txRef = `evt-${event_id.substring(0, 8)}-${Date.now()}`;
    const totalAmount = tier.price * quantity;

    if (provider === 'paystack') {
      // Fetch organizer's Paystack subaccount ID for automatic Split Payment
      let organizerSubaccount: string | undefined = event.payment_subaccount_id || undefined;
      if (!organizerSubaccount && event.organizer_id) {
        const { data: subaccountData } = await supabaseAdmin
          .from('seller_accounts')
          .select('paystack_subaccount_id')
          .eq('user_id', event.organizer_id)
          .eq('is_primary', true)
          .eq('is_active', true)
          .maybeSingle();

        if (subaccountData?.paystack_subaccount_id) {
          organizerSubaccount = subaccountData.paystack_subaccount_id;
        }
      }

      const origin = request.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || 'https://app.yrdly.ng';
      let paymentLink: string;
      try {
        paymentLink = await PaystackService.initializePayment({
          transactionId: txRef,
          amount: totalAmount,
          buyerEmail: attendee_email,
          buyerName: attendee_name,
          itemTitle: `${quantity}x ${tier.name} — ${event.title}`,
          sellerName: 'Event Organizer',
          subaccount: organizerSubaccount,
          callbackUrl: callbackUrl || `${origin}/api/events/tickets/verify?tx_ref=${txRef}`,
          metadata: {
            event_id,
            tier_id,
            quantity,
            buyer_id: user.id,
            attendee_name,
            attendee_email,
            attendee_phone: attendee_phone || null
          }
        });
      } catch (paystackError: any) {
        console.error('[TicketPurchase] Paystack init error:', paystackError);
        return NextResponse.json({
          error: 'Payment initialization failed',
          details: paystackError?.message || 'Paystack API error',
        }, { status: 502 });
      }

      const posthog = getPostHogClient();
      posthog.capture({
        distinctId: user.id,
        event: 'ticket_purchased_initiated',
        properties: {
          event_id,
          tier_id,
          tier_name: tier.name,
          quantity,
          amount: totalAmount,
          is_free: false,
          tx_ref: txRef,
          provider: 'paystack',
        },
      });

      return NextResponse.json({ success: true, payment_link: paymentLink, tx_ref: txRef, provider: 'paystack' });
    }

    // ── Payluk Escrow payment (Default) ───────────────────────────────────
    // Fetch or provision Payluk Customer IDs for buyer & organizer
    let buyerPaylukId: string;
    let organizerPaylukId: string;
    try {
      buyerPaylukId = await getPaylukCustomerId(user.id);
      organizerPaylukId = await getPaylukCustomerId(event.organizer_id);
    } catch (onboardingErr: any) {
      console.error('[TicketPurchase] Payluk onboarding error:', onboardingErr);
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

    // Calculate delivery window (in days)
    let maxDelivery = 7;
    if (event.end_time) {
      const msUntilEnd = new Date(event.end_time).getTime() - Date.now();
      const days = Math.ceil(msUntilEnd / (1000 * 60 * 60 * 24));
      maxDelivery = Math.max(1, Math.min(days + 1, 90));
    }

    let paylukEscrow;
    try {
      paylukEscrow = await PaylukService.createEscrow(organizerPaylukId, {
        amount: totalAmount,
        purpose: `${quantity}x ${tier.name} — ${event.title}`,
        whoPays: 'seller',
        maxDelivery,
        deliveryTimeline: 'days',
        totalQuantity: quantity,
      });

      const commission = Math.round(totalAmount * EVENT_CONSTANTS.COMMISSION_RATE * 100) / 100;
      if (commission > 0) {
        await PaylukService.addAdditionalFee(paylukEscrow.paymentToken, commission);
      }
    } catch (paylukError: any) {
      console.error('[TicketPurchase] Payluk createEscrow error:', paylukError);
      return NextResponse.json({
        error: 'Payment initialization failed',
        details: paylukError?.message || 'Payluk Escrow error',
      }, { status: 502 });
    }

    // Store escrow_transactions record
    const transactionId = crypto.randomUUID();
    const commission = Math.round(totalAmount * EVENT_CONSTANTS.COMMISSION_RATE * 100) / 100;
    const sellerAmount = totalAmount - commission;

    const { error: dbInsertErr } = await supabaseAdmin
      .from('escrow_transactions')
      .insert({
        id: transactionId,
        buyer_id: user.id,
        seller_id: event.organizer_id,
        amount: totalAmount,
        commission,
        total_amount: totalAmount,
        seller_amount: sellerAmount,
        status: EscrowStatus.PENDING,
        payment_method: 'card',
        delivery_details: { option: 'event_entry' },
        payment_provider: 'payluk',
        payment_reference: txRef,
        payluk_tx_ref: paylukEscrow.paymentToken,
        payluk_escrow_id: paylukEscrow.id,
        item_type: 'ticket',
        item_id: tier_id,
        metadata: {
          event_id,
          tier_id,
          quantity,
          buyer_id: user.id,
          attendee_name,
          attendee_email,
          attendee_phone: attendee_phone || null,
        },
      });

    if (dbInsertErr) {
      console.error('[TicketPurchase] Failed to store escrow_transactions row:', dbInsertErr);
      return NextResponse.json({
        error: 'Failed to store payment record',
        details: dbInsertErr.message,
      }, { status: 500 });
    }

    const isLive = process.env.PAYLUK_SECRET_KEY?.startsWith('sk_live_');
    const paylukHost = isLive ? 'https://payluk.ng' : 'https://staging.api.payluk.ng';
    const paymentLink = `${paylukHost}/escrow/${paylukEscrow.paymentToken}`;

    const posthog = getPostHogClient();
    posthog.capture({
      distinctId: user.id,
      event: 'ticket_purchased_initiated',
      properties: {
        event_id,
        tier_id,
        tier_name: tier.name,
        quantity,
        amount: totalAmount,
        is_free: false,
        tx_ref: txRef,
        payluk_escrow_id: paylukEscrow.id,
        provider: 'payluk',
      },
    });

    return NextResponse.json({
      success: true,
      payment_link: paymentLink,
      paylukPaymentToken: paylukEscrow.paymentToken,
      paylukEscrowId: paylukEscrow.id,
      buyerPaylukId,
      tx_ref: txRef,
      provider: 'payluk',
    });
  } catch (error) {
    console.error('[TicketPurchase] Ticket purchase error:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}

