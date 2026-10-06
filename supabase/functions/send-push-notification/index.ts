import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  data?: Record<string, unknown>;
  url?: string;
  badge?: number;
}

serve(async (req) => {
  // Handle preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { userId, payload, type } = await req.json() as {
      userId: string;
      payload: PushPayload;
      type?: string;
    };

    if (!userId || !payload) {
      return new Response(JSON.stringify({ error: 'Missing userId or payload' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Init Supabase admin client to read the user's push token
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Fetch notification preferences for this user from users table
    const { data: userData } = await supabaseAdmin
      .from('users')
      .select('notification_settings')
      .eq('id', userId)
      .single();

    // Fetch native device tokens and browser subscriptions. Web subscriptions
    // are separate from Expo tokens and must be sent with the Web Push protocol.
    const [tokenResult, webSubscriptionResult] = await Promise.all([
      supabaseAdmin
        .from('user_push_tokens')
        .select('push_token')
        .eq('user_id', userId),
      supabaseAdmin
        .from('push_subscriptions')
        .select('id, subscription')
        .eq('user_id', userId),
    ]);
    const { data: tokenRows, error: tokenError } = tokenResult;
    const { data: webSubscriptionRows, error: webSubscriptionError } = webSubscriptionResult;

    if (tokenError) console.error(`Could not load Expo tokens for ${userId}:`, tokenError.message);
    if (webSubscriptionError) console.error(`Could not load web subscriptions for ${userId}:`, webSubscriptionError.message);

    const validTokens = (tokenRows ?? [])
      .map((r) => r.push_token)
      .filter((t) => t.startsWith('ExponentPushToken[') || t.startsWith('ExpoPushToken['));
    const webSubscriptions = webSubscriptionRows ?? [];

    if (validTokens.length === 0 && webSubscriptions.length === 0) {
      console.log(`No push subscriptions found for user ${userId}`);
      return new Response(JSON.stringify({ success: false, reason: 'no_token' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Enforce notification preferences
    if (type && userData?.notification_settings) {
      const preferenceMap: Record<string, string> = {
        'message': 'messages',
        'marketplace_item_interest': 'messages',
        'catalog_item_inquiry': 'messages',
        'friend_request': 'friendRequests',
        'friend_request_accepted': 'friendRequests',
        'post_comment': 'comments',
        'post_like': 'postLikes',
        'event_invite': 'eventInvites',
        'item_shipped': 'orderUpdates',
        'delivery_confirmed': 'orderUpdates',
        'funds_released': 'orderUpdates',
        'payment_successful': 'paymentReceived',
        'payout_processed': 'paymentReceived',
        'payout_failed': 'paymentReceived',
        'dispute_opened': 'disputeUpdates',
        'dispute_resolved': 'disputeUpdates',
      };

      const mappedKey = preferenceMap[type];

      if (mappedKey) {
        if (userData.notification_settings[mappedKey] === false) {
          console.log(`Push skipped: User opted out of ${mappedKey} (type: ${type})`);
          return new Response(
            JSON.stringify({ success: true, skipped: true, reason: 'user_opt_out' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
          );
        }
      } else {
        // Unmapped types fall through to default-send.
      }
    }

    // Construct batch payload (array of push messages matching validTokens order)
    const expoPayloads = validTokens.map((pushToken) => ({
      to: pushToken,
      title: payload.title,
      body: payload.body,
      sound: 'default',
      badge: payload.badge ?? 1,
      data: {
        ...(payload.data ?? {}),
        url: payload.url ?? '/',
      },
      channelId: 'default',
      priority: 'high',
    }));

    const webPayload = JSON.stringify({
      title: payload.title,
      body: payload.body,
      icon: payload.icon ?? '/icon-192x192.png',
      badge: '/icon-192x192.png',
      data: { ...(payload.data ?? {}), url: payload.url ?? '/' },
    });

    let webSent = 0;
    const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY') ?? Deno.env.get('NEXT_PUBLIC_VAPID_PUBLIC_KEY');
    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');
    const vapidSubject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:support@yrdly.ng';

    if (webSubscriptions.length > 0 && vapidPublicKey && vapidPrivateKey) {
      try {
        webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
        const results = await Promise.allSettled(webSubscriptions.map(async (row) => {
          try {
            await webpush.sendNotification(row.subscription, webPayload);
            webSent += 1;
          } catch (error) {
            const statusCode = (error as { statusCode?: number }).statusCode;
            if (statusCode === 404 || statusCode === 410) {
              await supabaseAdmin.from('push_subscriptions').delete().eq('id', row.id);
            }
            throw error;
          }
        }));
        const failures = results.filter((result) => result.status === 'rejected').length;
        if (failures > 0) console.error(`Web push failed for ${failures} subscription(s) for user ${userId}`);
      } catch (error) {
        console.error('Could not send web push notifications:', error);
      }
    } else if (webSubscriptions.length > 0) {
      console.error('Web push subscriptions exist but VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are not configured');
    }

    let expoResult: { data?: Array<{ status?: string; details?: { error?: string } }> } | null = null;
    if (expoPayloads.length > 0) {
      const expoResponse = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Accept-Encoding': 'gzip, deflate',
        },
        body: JSON.stringify(expoPayloads),
      });

      if (!expoResponse.ok) throw new Error(`Expo push service returned ${expoResponse.status}`);
      expoResult = await expoResponse.json();
      console.log('Expo push result:', JSON.stringify(expoResult));
    }

    // Match batch ticket responses back to validTokens by array index
    // Expo returns an array of ticket objects in the exact order of the submitted payload array
    if (Array.isArray(expoResult?.data)) {
      for (let i = 0; i < expoResult.data.length; i++) {
        const ticket = expoResult.data[i];
        if (ticket?.status === 'error' && ticket?.details?.error === 'DeviceNotRegistered') {
          const failedToken = validTokens[i];
          if (failedToken) {
            console.log(`Deleting invalid push token row for user ${userId}: ${failedToken}`);
            await supabaseAdmin
              .from('user_push_tokens')
              .delete()
              .eq('push_token', failedToken);
          }
        }
      }
    }

    const expoAccepted = expoResult?.data?.some((ticket) => ticket?.status === 'ok') ?? false;
    return new Response(JSON.stringify({
      success: webSent > 0 || expoAccepted,
      webSent,
      expoResult,
      reason: webSent === 0 && !expoAccepted ? 'delivery_failed' : undefined,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('send-push-notification error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
