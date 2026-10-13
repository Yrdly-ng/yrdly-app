import { NextRequest, NextResponse } from 'next/server';
import { POST as checkin } from '@/app/api/events/checkin/route';

/** Backward-compatible adapter; all validation and atomic writes live in checkin. */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const adapted = new NextRequest(request.url, { method: 'POST', headers: request.headers,
      body: JSON.stringify({ ticket_code: body.ticketInput || body.ticketCode || body.ticketId, event_id: body.eventId }) });
    const response = await checkin(adapted);
    const result = await response.json();
    return NextResponse.json({ ...result, success: result.valid === true, reason: result.message || result.error }, { status: response.status });
  } catch {
    return NextResponse.json({ error: 'Invalid scan request' }, { status: 400 });
  }
}
