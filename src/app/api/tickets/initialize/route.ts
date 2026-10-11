import { NextRequest, NextResponse } from 'next/server';
import { POST as purchaseTickets } from '@/app/api/events/tickets/purchase/route';

/** Compatibility endpoint using the same Payluk checkout and commission rules. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const response = await purchaseTickets(new NextRequest(request.url, {
    method: 'POST',
    headers: request.headers,
    body: JSON.stringify({
      event_id: body.eventId,
      tier_id: body.tierId,
      attendee_name: body.attendeeName,
      attendee_email: body.attendeeEmail,
      attendee_phone: body.attendeePhone,
      quantity: 1,
    }),
  }));
  const result = await response.json();
  if (!response.ok) return NextResponse.json(result, { status: response.status });

  return NextResponse.json({
    ...result,
    ticketId: result.ticket_id,
    paymentLink: result.payment_link,
    txRef: result.tx_ref,
  });
}
