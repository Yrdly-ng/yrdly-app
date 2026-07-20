import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from "@/lib/supabase-server";
import { supabaseAdmin } from '@/lib/supabase-admin';
import { createClient } from '@supabase/supabase-js';
import { getPostHogClient } from '@/lib/posthog-server';

/**
 * POST /api/events/create
 * Creates a new event (as DRAFT or PUBLISHED) with ticket tiers.
 */
export async function POST(request: NextRequest) {
  try {
    // ── Auth ──────────────────────────────────────────────
    const { data: { user }, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    const body = await request.json();
    const {
      title, description, category, coverImageUrl, imageUrls,
      locationAddress, locationOnline, onlineLink, lat, lng, ward, lga, state,
      startTime, endTime, timezone,
      visibility, publish,
      ticketTiers, // array of { name, description, price, capacity, saleEndsAt }
    } = body;

    if (!title || !startTime) {
      return NextResponse.json({ error: 'title and startTime are required' }, { status: 400 });
    }

    // ── Gate: paid events require a payout account ────────
    const hasPaidTiers = (ticketTiers || []).some((t: any) => t.price > 0);
    if (hasPaidTiers) {
      const { data: sellerAccount } = await supabaseAdmin
        .from('seller_accounts')
        .select('id, payment_subaccount_id')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();

      if (!sellerAccount) {
        return NextResponse.json(
          { error: 'PAYOUT_ACCOUNT_REQUIRED', message: 'Link your bank account in Settings → Payout Settings before creating a paid event.' },
          { status: 402 }
        );
      }
    }

    // Get subaccount ID if exists
    const { data: sa } = await supabaseAdmin
      .from('seller_accounts')
      .select('payment_subaccount_id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    // Get user profile for location fallback and post creation
    const { data: userProfile } = await supabaseAdmin
      .from('users')
      .select('name, avatar_url, location')
      .eq('id', user.id)
      .single();

    const finalState = state || userProfile?.location?.state || null;
    const finalLga = lga || userProfile?.location?.lga || null;
    const finalWard = ward || userProfile?.location?.ward || null;

    const now = new Date().toISOString();
    const status = publish ? 'PUBLISHED' : 'DRAFT';

    // ── Create event ──────────────────────────────────────
    const { data: event, error: eventError } = await supabaseAdmin
      .from('events')
      .insert({
        organizer_id: user.id,
        title,
        description,
        category: category || 'General',
        cover_image_url: coverImageUrl,
        location_address: locationAddress,
        location_online: locationOnline || false,
        online_link: onlineLink,
        lat, lng, ward: finalWard, lga: finalLga, state: finalState,
        start_time: startTime,
        end_time: endTime,
        timezone: timezone || 'Africa/Lagos',
        status,
        visibility: visibility || 'PUBLIC',
        payout_mode: 'POST_EVENT',
        payment_subaccount_id: sa?.payment_subaccount_id || null,
        published_at: publish ? now : null,
      })
      .select('id')
      .single();

    if (eventError) {
      console.error('Event create error:', eventError);
      return NextResponse.json({ error: 'Failed to create event' }, { status: 500 });
    }

    // ── Create ticket tiers ───────────────────────────────
    if (ticketTiers && ticketTiers.length > 0) {
      const tiersToInsert = ticketTiers.map((t: any) => ({
        event_id: event.id,
        name: t.name,
        description: t.description || null,
        price: t.price ?? 0,
        capacity: t.capacity || null,
        sold: 0,
        is_visible: true,
        sale_ends_at: t.saleEndsAt || null,
      }));

      const { error: tiersError } = await supabaseAdmin
        .from('ticket_tiers')
        .insert(tiersToInsert);

      if (tiersError) {
        console.error('Ticket tiers error:', tiersError);
      }
    }

    // ── Create linked post in community feed ──────────────
    if (publish) {
      try {
        await supabaseAdmin.from('posts').insert({
          user_id: user.id,
          author_name: userProfile?.name || 'Anonymous',
          author_image: userProfile?.avatar_url || '',
          category: 'Event',
          title: title,
          text: description,
          event_location: { address: locationAddress || finalState || '' },
          event_date: startTime.split('T')[0],
          event_time: new Date(startTime).toTimeString().split(' ')[0].substring(0, 5),
          event_link: `${process.env.NEXT_PUBLIC_APP_URL || 'https://yrdly.ng'}/events/${event.id}`,
          image_urls: imageUrls && imageUrls.length > 0 ? imageUrls : coverImageUrl ? [coverImageUrl] : [],
          timestamp: now,
          state: finalState,
          lga: finalLga,
          ward: finalWard,
          author_location: userProfile?.location || null,
          comment_count: 0,
          liked_by: [],
          attendees: [],
        });
      } catch (postError) {
        console.error('Failed to create linked post:', postError);
        // Non-critical, continue
      }
    }

    try {
      const posthog = getPostHogClient();
      posthog.capture({
        distinctId: user.id,
        event: 'event_created',
        properties: {
          event_id: event.id,
          title,
          category: category || 'General',
          status,
          has_paid_tiers: hasPaidTiers,
          ticket_tier_count: (ticketTiers || []).length,
        },
      });
    } catch (phError) {
      console.error('PostHog error:', phError);
    }

    return NextResponse.json({ success: true, eventId: event.id, status });
  } catch (error) {
    console.error('Create event error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
