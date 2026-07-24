import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAuthenticatedUser } from "@/lib/supabase-server";
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/events/[id]/attendees
 * Returns full attendee list for an event — organizer only.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const { data: { user }, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });

    // ── Verify organizer ─────────────────────────────────────────────────────
    const { data: event } = await supabaseAdmin
      .from('events')
      .select('id, organizer_id, title')
      .eq('id', id)
      .single();

    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    if (event.organizer_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // ── Fetch attendees ──────────────────────────────────────────────────────
    const { data: tickets, error } = await supabaseAdmin
      .from('tickets')
      .select(`
        id,
        ticket_code,
        attendee_name,
        attendee_email,
        attendee_phone,
        status,
        amount_paid,
        scanned_at,
        created_at,
        tier:ticket_tiers!tickets_tier_id_fkey(id, name, price)
      `)
      .eq('event_id', id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // ── Stats summary ────────────────────────────────────────────────────────
    const all = tickets || [];
    const summary = {
      total: all.length,
      paid: all.filter(t => t.status === 'PAID').length,
      used: all.filter(t => t.status === 'USED').length,
      refunded: all.filter(t => t.status === 'REFUNDED').length,
      gross_revenue: all
        .filter(t => t.status !== 'REFUNDED' && t.status !== 'CANCELLED')
        .reduce((sum, t) => sum + Number(t.amount_paid), 0),
    };

    return NextResponse.json({ success: true, attendees: all, summary });
  } catch (error) {
    console.error('Attendees fetch error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
