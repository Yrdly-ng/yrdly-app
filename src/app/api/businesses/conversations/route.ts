import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase/supabase-server';
import { supabaseAdmin } from '@/lib/supabase/supabase-admin';
import { NotificationService } from '@/lib/notifications/server-notification-service';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const { data: { user }, error: authError } = await getAuthenticatedUser(request);
  if (authError || !user) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: authError?.status === 403 ? 403 : authError?.status === 503 ? 503 : 401 },
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body.businessId !== 'string' || !uuid.test(body.businessId) ||
      (body.itemId !== undefined && (typeof body.itemId !== 'string' || !uuid.test(body.itemId)))) {
    return NextResponse.json({ error: 'Invalid business conversation request' }, { status: 400 });
  }

  const { data: allowed, error: rateError } = await supabaseAdmin.rpc('consume_rate_limit', {
    p_user_id: user.id,
    p_endpoint: '/api/businesses/conversations',
    p_max_requests: 30,
    p_window_seconds: 60,
  });
  if (rateError || !allowed) {
    return NextResponse.json({ error: 'Conversation service is temporarily unavailable' }, { status: rateError ? 503 : 429 });
  }

  const { data: business, error: businessError } = await supabaseAdmin
    .from('businesses')
    .select('id, owner_id, name, logo, logo_url, image_urls, is_active, moderation_status, is_flagged')
    .eq('id', body.businessId)
    .maybeSingle();

  if (businessError) {
    console.error('[BusinessConversation] Could not load business', { code: businessError.code });
    return NextResponse.json({ error: 'Could not open this business chat' }, { status: 503 });
  }
  if (!business || !business.is_active || business.moderation_status !== 'approved' || business.is_flagged) {
    return NextResponse.json({ error: 'Business unavailable' }, { status: 404 });
  }

  let item: { id: string; title: string; images: string[] | null; price: number } | null = null;
  if (body.itemId) {
    const { data, error } = await supabaseAdmin
      .from('catalog_items')
      .select('id, business_id, title, images, price, moderation_status')
      .eq('id', body.itemId)
      .eq('business_id', business.id)
      .maybeSingle();
    if (error) {
      console.error('[BusinessConversation] Could not load catalog item', { code: error.code });
      return NextResponse.json({ error: 'Could not open this item chat' }, { status: 503 });
    }
    if (!data || data.moderation_status !== 'approved') {
      return NextResponse.json({ error: 'Catalog item unavailable' }, { status: 404 });
    }
    item = data;
  }

  const participantIds = [...new Set([user.id, business.owner_id])].sort();
  let existingQuery = supabaseAdmin
    .from('conversations')
    .select('id')
    .contains('participant_ids', participantIds)
    .eq('type', 'business')
    .eq('business_id', business.id);

  existingQuery = item
    ? existingQuery.contains('context', { catalog_item_id: item.id })
    : existingQuery.is('context', null);

  const { data: existing, error: existingError } = await existingQuery.limit(1).maybeSingle();
  if (existingError) {
    console.error('[BusinessConversation] Could not find existing conversation', { code: existingError.code });
    return NextResponse.json({ error: 'Could not open this business chat' }, { status: 503 });
  }
  if (existing?.id) return NextResponse.json({ conversationId: existing.id, created: false });

  const insertData = {
    participant_ids: participantIds,
    type: 'business',
    business_id: business.id,
    business_name: business.name,
    business_logo: business.logo || business.logo_url || business.image_urls?.[0] || null,
    item_id: null,
    ...(item ? {
      item_title: item.title,
      item_image: item.images?.[0] || '/placeholder.svg',
      item_price: item.price,
      context: { catalog_item_id: item.id, catalog_item_business_id: business.id },
    } : {}),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { data: created, error: createError } = await supabaseAdmin
    .from('conversations')
    .insert(insertData)
    .select('id')
    .single();

  if (createError) {
    // A concurrent request may have created the same conversation after our lookup.
    const { data: concurrent } = await existingQuery.limit(1).maybeSingle();
    if (concurrent?.id) return NextResponse.json({ conversationId: concurrent.id, created: false });
    console.error('[BusinessConversation] Could not create conversation', { code: createError.code });
    return NextResponse.json({ error: 'Could not open this business chat' }, { status: 500 });
  }

  if (item && business.owner_id !== user.id) {
    try {
      const { data: customer } = await supabaseAdmin
        .from('users')
        .select('name')
        .eq('id', user.id)
        .maybeSingle();
      const customerName = (customer?.name || 'A customer').trim().slice(0, 80);
      await NotificationService.createNotification({
        userId: business.owner_id,
        senderId: user.id,
        type: 'catalog_item_inquiry',
        title: 'New catalog inquiry',
        message: `${customerName} is interested in ${item.title.slice(0, 100)}.`,
        relatedId: created.id,
        relatedType: 'conversation',
        data: {
          conversationId: created.id,
          businessId: business.id,
          catalogItemId: item.id,
          itemTitle: item.title.slice(0, 100),
        },
      });
    } catch (notificationError) {
      // The conversation is already persisted; notification delivery is non-fatal.
      console.error('[BusinessConversation] Conversation created; inquiry notification failed', {
        conversationId: created.id,
        error: notificationError instanceof Error ? notificationError.message : 'unknown',
      });
    }
  }

  return NextResponse.json({ conversationId: created.id, created: true });
}
