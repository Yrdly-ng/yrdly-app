import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PushPayload {
  title: string;
  body: string;
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

    // Fetch all active device push tokens for this user from user_push_tokens table
    const { data: tokenRows, error: tokenError } = await supabaseAdmin
      .from('user_push_tokens')
      .select('push_token')
      .eq('user_id', userId);

    if (tokenError || !tokenRows || tokenRows.length === 0) {
      console.log(`No push tokens found for user ${userId}:`, tokenError?.message);
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

    // Filter valid Expo push tokens
    const validTokens = tokenRows
      .map((r) => r.push_token)
      .filter((t) => t.startsWith('ExponentPushToken[') || t.startsWith('ExpoPushToken['));

    if (validTokens.length === 0) {
      console.log(`No valid push token format found for user ${userId}`);
      return new Response(JSON.stringify({ success: false, reason: 'invalid_token_format' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
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

    // Send batch via Expo Push Notification Service
    const expoResponse = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
      },
      body: JSON.stringify(expoPayloads),
    });

    const expoResult = await expoResponse.json();
    console.log('Expo push result:', JSON.stringify(expoResult));

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

    return new Response(JSON.stringify({ success: true, result: expoResult }), {
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
