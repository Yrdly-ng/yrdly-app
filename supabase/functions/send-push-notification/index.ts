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

    const { userId, payload } = await req.json();

    if (!userId || !payload) {
      throw new Error('userId and payload are required');
    }

    // 1. Get the user's push token
    const { data: user, error: userError } = await supabaseClient
      .from('users')
      .select('push_token')
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
