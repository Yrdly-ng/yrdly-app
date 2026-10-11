import { NextRequest, NextResponse } from 'next/server';
import { POST as cancelEvent } from '../[id]/cancel/route';

/** Backward-compatible entry point; all refund and ownership checks live in one handler. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body?.eventId || typeof body.eventId !== 'string') return NextResponse.json({ error: 'Missing eventId' }, { status: 400 });
  return cancelEvent(request, { params: Promise.resolve({ id: body.eventId }) });
}
