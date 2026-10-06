import type { SupabaseClient } from '@supabase/supabase-js';

type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  url?: string;
};

export async function sendPushNotification(
  supabaseAdmin: SupabaseClient,
  userId: string,
  payload: PushPayload,
  type?: string,
): Promise<void> {
  try {
    const { error } = await supabaseAdmin.functions.invoke('send-push-notification', {
      body: { userId, payload, type },
    });
    if (error) console.error(`Push notification dispatch failed for ${userId}:`, error.message);
  } catch (error) {
    console.error(`Push notification dispatch failed for ${userId}:`, error);
  }
}
