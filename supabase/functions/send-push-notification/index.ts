import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { userId, payload, type } = await req.json();

    if (!userId || !payload) {
      throw new Error('userId and payload are required');
    }

    // 1. Get the user's push token and preferences
    const { data: user, error: userError } = await supabaseClient
      .from('users')
      .select('push_token, notification_settings')
      .eq('id', userId)
      .single();

    if (userError) {
      throw new Error(`Error fetching user: ${userError.message}`);
    }

    const pushToken = user?.push_token;

    if (!pushToken) {
      return new Response(
        JSON.stringify({ success: false, error: 'User does not have a push token' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // 1.5 Enforce notification preferences
    if (type && user?.notification_settings) {
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
        if (user.notification_settings[mappedKey] === false) {
          console.log(`Push skipped: User opted out of ${mappedKey} (type: ${type})`);
          return new Response(
            JSON.stringify({ success: true, skipped: true, reason: 'user_opt_out' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
          );
        }
      } else {
        // Unmapped types fall through to default-send.
        // This covers two distinct cases:
        // 1. Genuinely no-toggle-exists-yet types (e.g. business_review_received, catalog_item_out_of_stock)
        // 2. Intentionally always-sent critical types (e.g. welcome, system_announcement)
      }
    }

    // 2. Send push notification via Expo
    const expoResponse = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
        // Optional: Include an Expo Access Token if required by the Expo project
        ...(Deno.env.get('EXPO_ACCESS_TOKEN') ? { Authorization: `Bearer ${Deno.env.get('EXPO_ACCESS_TOKEN')}` } : {})
      },
      body: JSON.stringify({
        to: pushToken,
        sound: 'default',
        title: payload.title,
        body: payload.body,
        data: payload.data || {},
        badge: payload.badge ? parseInt(payload.badge, 10) : undefined,
      }),
    });

    const expoData = await expoResponse.json();

    if (expoData.errors) {
      throw new Error(`Expo Push API Error: ${JSON.stringify(expoData.errors)}`);
    }

    return new Response(
      JSON.stringify({ success: true, data: expoData }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
