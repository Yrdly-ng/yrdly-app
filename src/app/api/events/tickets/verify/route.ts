import { NextRequest, NextResponse } from 'next/server';
import { TicketService } from '@/lib/ticket-service';
import { getAuthenticatedUser } from '@/lib/supabase-server';

export async function POST(request: NextRequest) {
  try {
    const { data: { user }, error } = await getAuthenticatedUser(request);
    if (error || !user) return NextResponse.json({ error: 'Invalid session' }, { status: error?.status === 403 ? 403 : error?.status === 503 ? 503 : 401 });
    const { tx_ref } = await request.json();

    if (!tx_ref) {
      return NextResponse.json({ error: 'Missing tx_ref' }, { status: 400 });
    }

    const ticket = await TicketService.verifyAndProcessTicket(tx_ref, user.id);
    return NextResponse.json({ success: true, ticket: { id: ticket.id, event_id: ticket.event_id } });
  } catch (error: any) {
    console.error('Ticket verify POST error:', error);
    return NextResponse.json({ error: error.message || 'Verification failed' }, { status: error.message === 'ticket_buyer_mismatch' ? 403 : 400 });
  }
}

/**
 * GET /api/events/tickets/verify?tx_ref=...
 * Payluk checkout return URL for server-side payment verification.
 * Verifies the transaction, creates the ticket, generates QR, fires confirmation email.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const txRef = searchParams.get('tx_ref');
  const status = searchParams.get('status');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.yrdly.ng';

  if (!txRef) {
    return NextResponse.redirect(`${appUrl}/events?error=invalid_ref`);
  }

  // Payment was cancelled by user
  if (status === 'cancelled') {
    return NextResponse.redirect(`${appUrl}/events?error=payment_cancelled`);
  }

  try {
    await TicketService.verifyAndProcessTicket(txRef);
    return NextResponse.redirect(`${appUrl}/my-tickets?success=1`);
  } catch (error: any) {
    console.error('Ticket verify error:', error);
    
    // Redirect based on error type
    if (error.message === 'sold_out_payluk_refund_required') {
      // Need event_id to redirect properly, but if it failed here, we just go to events list or my-tickets
      return NextResponse.redirect(`${appUrl}/events?error=${error.message}&tx_ref=${encodeURIComponent(txRef)}`);
    } else if (error.message === 'payment_failed') {
      return NextResponse.redirect(`${appUrl}/events?error=payment_failed`);
    }
    
    return NextResponse.redirect(`${appUrl}/events?error=verification_failed`);
  }
}
