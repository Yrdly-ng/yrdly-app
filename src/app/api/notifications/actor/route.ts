import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { NotificationService } from '@/lib/server-notification-service';

/** Client notifications are derived from a persisted action, never financial claims. */
export async function POST(request: NextRequest) {
  const { data: { user }, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status:error?.status === 403 ? 403 : error?.status === 503 ? 503 : 401 });
  const body = await request.json().catch(() => null);
  if (body?.type === 'welcome') body.relatedId = user.id;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!body || !uuid.test(body.userId) || !uuid.test(body.relatedId) || (body.userId === user.id && body.type !== 'welcome')) {
    return NextResponse.json({ error: 'Invalid notification action' }, { status: 400 });
  }
  const { data: rate, error: rateError } = await supabaseAdmin.rpc('consume_rate_limit', {
    p_user_id: user.id, p_endpoint: '/api/notifications/actor', p_max_requests: 60, p_window_seconds: 60,
  });
  if (rateError || !rate) return NextResponse.json({ error: 'Notification unavailable' }, { status: rateError ? 503 : 429 });
  let authorized = false;
  let title = 'New activity';
  let relatedType = '';
  let action = '';
  if (['friend_request', 'friend_request_accepted', 'friend_request_declined'].includes(body.type)) {
    const sent = body.type === 'friend_request';
    const { data: requestRow } = await supabaseAdmin.from('friend_requests').select('status')
      .eq('from_user_id', sent ? user.id : body.userId).eq('to_user_id', sent ? body.userId : user.id).maybeSingle();
    const { data: follow } = await supabaseAdmin.from('followers').select('id')
      .eq('follower_id', user.id).eq('following_id', body.userId).maybeSingle();
    authorized = sent ? requestRow?.status === 'pending' || !!follow : body.type === 'friend_request_accepted' ? !!follow : requestRow?.status === 'declined';
    title = sent ? 'New Friend Request' : body.type === 'friend_request_accepted' ? 'Friend Request Accepted' : 'Friend Request Declined';
    action = sent ? 'sent you a friend request.' : body.type === 'friend_request_accepted' ? 'accepted your friend request.' : 'declined your friend request.';
    relatedType = 'user';
  } else if (['message', 'marketplace_message', 'catalog_item_inquiry'].includes(body.type)) {
    const { data: conversation } = await supabaseAdmin.from('conversations').select('participant_ids').eq('id', body.relatedId).maybeSingle();
    const { data: message } = await supabaseAdmin.from('messages').select('id').eq('conversation_id', body.relatedId).eq('sender_id', user.id).limit(1);
    authorized = conversation?.participant_ids?.includes(user.id) && conversation.participant_ids.includes(body.userId) && !!message?.length;
    title = 'New Message'; action = 'sent you a message.'; relatedType = 'conversation';
  } else if (['post_like', 'post_comment', 'post_share', 'mention'].includes(body.type)) {
    const { data: post } = await supabaseAdmin.from('posts').select('user_id,liked_by,text,moderation_status').eq('id', body.relatedId).maybeSingle();
    if (post?.moderation_status === 'approved') {
      if (body.type === 'post_like') authorized = post.user_id === body.userId && (body.remove || post.liked_by?.includes(user.id));
      if (body.type === 'post_comment') {
        const { data: comments } = await supabaseAdmin.from('comments').select('id').eq('post_id', body.relatedId).eq('user_id', user.id).limit(1);
        authorized = post.user_id === body.userId && !!comments?.length;
      }
      if (body.type === 'mention') {
        const { data: recipient } = await supabaseAdmin.from('users').select('username').eq('id', body.userId).single();
        const { data:comments } = await supabaseAdmin.from('comments').select('text').eq('post_id',body.relatedId).eq('user_id',user.id);
        const content = [post.user_id === user.id ? post.text : '',...(comments || []).map(comment => comment.text)].join(' ');
        authorized = !!recipient?.username && Array.from(content.matchAll(/(?:^|\s)@([a-zA-Z0-9_.-]+)/g),match => match[1].toLowerCase()).includes(recipient.username.toLowerCase());
      }
    }
    if (body.type === 'post_share') authorized = post?.moderation_status === 'approved' && post.user_id === body.userId;
    title = body.type === 'post_like' ? 'New Like' : body.type === 'mention' ? 'You Were Mentioned' : body.type === 'post_share' ? 'Post Shared' : 'New Comment';
    action = body.type === 'post_like' ? 'liked your post.' : body.type === 'mention' ? 'mentioned you in a post.' : body.type === 'post_share' ? 'shared your post.' : 'commented on your post.'; relatedType = 'post';
  } else if (['booking_requested', 'booking_confirmed', 'booking_cancelled', 'booking_no_show'].includes(body.type)) {
    const { data: booking } = await supabaseAdmin.from('bookings').select('customer_id,business_id,status').eq('id', body.relatedId).maybeSingle();
    const { data: business } = booking ? await supabaseAdmin.from('businesses').select('owner_id').eq('id', booking.business_id).single() : { data: null };
    const participants = [booking?.customer_id, business?.owner_id];
    authorized = participants.includes(user.id) && participants.includes(body.userId) &&
      ({ booking_requested: 'requested', booking_confirmed: 'confirmed', booking_cancelled: 'cancelled', booking_no_show: 'no_show' } as Record<string, string>)[body.type] === booking?.status || (participants.includes(user.id) && participants.includes(body.userId) && body.type === 'booking_cancelled' && booking?.status === 'late_cancelled');
    title = 'Booking Updated'; action = `updated your booking (${booking?.status}).`; relatedType = 'booking';
  }
  if (body.type === 'welcome' && body.userId === user.id && body.relatedId === user.id) {
    authorized = true;title = 'Welcome to Yrdly';action = 'welcome to your neighbourhood.';relatedType = 'user';
  } else if (body.type === 'marketplace_item_interest') {
    const { data:conversations } = await supabaseAdmin.from('conversations').select('id').eq('item_id',body.relatedId)
      .contains('participant_ids',[user.id,body.userId]).limit(1);
    const { data:post } = await supabaseAdmin.from('posts').select('user_id').eq('id',body.relatedId).single();
    authorized = post?.user_id === body.userId && !!conversations?.length;
    title = 'Item inquiry';action = 'is interested in your item.';relatedType = 'marketplace_item';
  } else if (body.type === 'event_invite') {
    const { data:event } = await supabaseAdmin.from('events').select('organizer_id,status,moderation_status').eq('id',body.relatedId).single();
    const { data:friend } = await supabaseAdmin.from('followers').select('id').eq('follower_id',user.id).eq('following_id',body.userId).maybeSingle();
    const { data:reverse } = await supabaseAdmin.from('followers').select('id').eq('follower_id',body.userId).eq('following_id',user.id).maybeSingle();
    authorized = event?.organizer_id === user.id && event?.status === 'PUBLISHED' && event?.moderation_status === 'approved' && !!friend && !!reverse;
    title = 'Event invitation';action = 'invited you to an event.';relatedType = 'event';
  } else if (['quote_estimated','quote_converted'].includes(body.type)) {
    const { data:quote } = await supabaseAdmin.from('quote_requests').select('customer_id,business_id,status,converted_booking_id').eq('id',body.relatedId).single();
    const { data:business } = quote ? await supabaseAdmin.from('businesses').select('owner_id').eq('id',quote.business_id).single() : { data:null };
    authorized = body.type === 'quote_estimated' ? quote?.status === 'estimated' && business?.owner_id === user.id && quote.customer_id === body.userId
      : !!quote?.converted_booking_id && quote.customer_id === user.id && business?.owner_id === body.userId;
    title = 'Quote updated';action = body.type === 'quote_estimated' ? 'sent you a service estimate.' : 'accepted your service estimate.';relatedType = 'quote';
  } else if (body.type === 'business_review_received') {
    const { data:review } = await supabaseAdmin.from('business_reviews').select('user_id,business_id').eq('id',body.relatedId).single();
    const { data:business } = review ? await supabaseAdmin.from('businesses').select('owner_id').eq('id',review.business_id).single() : { data:null };
    authorized = review?.user_id === user.id && business?.owner_id === body.userId;
    title = 'New business review';action = 'reviewed your business.';relatedType = 'review';
  } else if (body.type === 'appeal_decided') {
    const { data:appeal } = await supabaseAdmin.from('strike_appeals').select('appellant_id,status,reviewed_by').eq('id',body.relatedId).single();
    const { data:admin } = await supabaseAdmin.from('users').select('is_admin').eq('id',user.id).single();
    authorized = admin?.is_admin && appeal?.reviewed_by === user.id && appeal?.appellant_id === body.userId && ['approved','rejected'].includes(appeal.status);
    title = 'Appeal reviewed';action = `reviewed your appeal (${appeal?.status}).`;relatedType = 'appeal';
  }
  if (!authorized) return NextResponse.json({ error: 'Notification is not supported by an authorized action' }, { status: 403 });
  if (body.remove) {
    if (body.type !== 'post_like') return NextResponse.json({ error: 'Invalid removal' }, { status: 400 });
    const { error: removeError } = await supabaseAdmin.rpc('remove_notification_actor', { p_user_id: body.userId, p_type: body.type, p_sender_id: user.id, p_related_id: body.relatedId });
    return removeError ? NextResponse.json({ error: 'Could not update notification' }, { status: 500 }) : NextResponse.json({ success: true });
  }
  const { data: actor } = await supabaseAdmin.from('users').select('name').eq('id', user.id).single();
  const id = await NotificationService.createNotification({ userId: body.userId, type: body.type, senderId: user.id,
    relatedId: body.relatedId, relatedType, title, message: `${actor?.name || 'A user'} ${action}`, data: {} });
  return NextResponse.json({ id });
}
