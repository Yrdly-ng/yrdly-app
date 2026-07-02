import { NextRequest, NextResponse } from 'next/server';
import { TicketService } from '@/lib/ticket-service';

/**
 * GET /api/events/tickets/verify?tx_ref=...
 * Paystack redirects here after payment.
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
    const ticket = await TicketService.verifyAndProcessTicket(txRef);
    return NextResponse.redirect(`${appUrl}/my-tickets?success=1&ticket_id=${ticket.id}`);
  } catch (error: any) {
    console.error('Ticket verify error:', error);
    
    // Redirect based on error type
    if (error.message === 'sold_out_refunded') {
      // Need event_id to redirect properly, but if it failed here, we just go to events list or my-tickets
      return NextResponse.redirect(`${appUrl}/events?error=sold_out_refunded`);
    } else if (error.message === 'payment_failed') {
      return NextResponse.redirect(`${appUrl}/events?error=payment_failed`);
    }
    
    return NextResponse.redirect(`${appUrl}/events?error=verification_failed`);
  }
}
