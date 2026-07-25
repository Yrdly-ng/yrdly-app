import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from "@/lib/supabase-server";
import { supabaseAdmin } from '@/lib/supabase-admin';
import { createClient } from '@supabase/supabase-js';
import { getPostHogClient } from '@/lib/posthog-server';

/**
 * POST /api/events/[id]/publish
 * Transitions a DRAFT event to PUBLISHED.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { data: { user }, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });

    const { data: event } = await supabaseAdmin
      .from('events')
      .select('id, organizer_id, status')
      .eq('id', id)
      .single();

    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    if (event.organizer_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (event.status === 'PUBLISHED') return NextResponse.json({ success: true, message: 'Already published' });

    const { error } = await supabaseAdmin
      .from('events')
      .update({ status: 'PUBLISHED', published_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) return NextResponse.json({ error: 'Failed to publish' }, { status: 500 });

    const posthog = getPostHogClient();
    posthog.capture({
      distinctId: user.id,
      event: 'event_published',
      properties: { event_id: id },
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
