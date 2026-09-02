import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

/**
 * POST /api/events/create
 * Creates an event with ticket tiers for the authenticated mobile user.
 */
export async function POST(request: NextRequest) {
  try {
    const {
      data: { user },
      error: authError,
    } = await getAuthenticatedUser(request);
    if (authError || !user) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    const body = await request.json();
    const {
      title, description, category,
      coverImageUrl, imageUrls, videoUrls,
      locationAddress, locationOnline, onlineLink,
      lat, lng, ward, lga, state,
      startTime, endTime, visibility, publish,
      ticketTiers,
    } = body;

    if (!title || !startTime || !endTime) {
      return NextResponse.json(
        { error: 'Missing required fields: title, startTime, endTime' },
        { status: 400 }
      );
    }

    // Block paid events if no payout account linked
    const hasPaidTiers = Array.isArray(ticketTiers) && ticketTiers.some((t: any) => (t.price ?? 0) > 0);
    if (hasPaidTiers) {
      const { data: sellerAccount } = await supabaseAdmin
        .from('seller_accounts')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (!sellerAccount) {
        return NextResponse.json(
          { error: 'PAYOUT_ACCOUNT_REQUIRED', message: 'Link a bank account in Settings → Payout Settings before creating paid events.' },
          { status: 400 }
        );
      }
    }

    const status = publish ? 'PUBLISHED' : 'DRAFT';
    const publishedAt = publish ? new Date().toISOString() : null;

    const { data: newEvent, error: eventError } = await supabaseAdmin
      .from('events')
      .insert({
        organizer_id: user.id,
        title: title.trim(),
        description: (description || '').trim(),
        category: category || null,
        cover_image_url: coverImageUrl || null,
        image_urls: imageUrls || [],
        video_urls: videoUrls || [],
        location_address: locationAddress || null,
        location_online: locationOnline ?? false,
        online_link: onlineLink || null,
        lat: lat ?? null,
        lng: lng ?? null,
        ward: ward || null,
        lga: lga || null,
        state: state || null,
        start_time: startTime,
        end_time: endTime,
        status,
        visibility: visibility || 'PUBLIC',
        published_at: publishedAt,
      })
      .select('id')
      .single();

    if (eventError || !newEvent) {
      console.error('[events/create] DB insert error:', eventError);
      return NextResponse.json(
        { error: eventError?.message || 'Failed to create event' },
        { status: 500 }
      );
    }

    const eventId = newEvent.id;

    if (Array.isArray(ticketTiers) && ticketTiers.length > 0) {
      const tiersToInsert = ticketTiers.map((t: any) => ({
        event_id: eventId,
        name: (t.name || 'General Admission').trim(),
        description: t.description || null,
        price: Number(t.price) || 0,
        capacity: t.capacity != null ? Number(t.capacity) : null,
        sold: 0,
        is_visible: true,
      }));
      const { error: tiersError } = await supabaseAdmin.from('ticket_tiers').insert(tiersToInsert);
      if (tiersError) {
        console.error('[events/create] Ticket tiers insert error:', tiersError);
      }
    }

    return NextResponse.json({ success: true, eventId });
  } catch (err: any) {
    console.error('[events/create] Unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
