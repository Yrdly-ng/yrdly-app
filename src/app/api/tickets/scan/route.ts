import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from "@/lib/supabase-server";
import { supabaseAdmin } from '@/lib/supabase-admin';
import { createClient } from '@supabase/supabase-js';

/**
 * POST /api/tickets/scan
 * Scans a ticket token. Returns the attendee info if valid, or an error if invalid/used.
 */
export async function POST(request: NextRequest) {
  try {
    const { data: { user }, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });

    const { ticketId, eventId } = await request.json();

    if (!ticketId || !eventId) {
      return NextResponse.json({ error: 'ticketId and eventId are required' }, { status: 400 });
    }

    const { data: result, error: rpcError } = await supabaseAdmin.rpc('scan_ticket', {
      p_ticket_id: ticketId,
      p_scanner_id: user.id,
      p_event_id: eventId
    });

    if (rpcError) {
      console.error('Scan ticket rpc error:', rpcError);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Scan ticket error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
