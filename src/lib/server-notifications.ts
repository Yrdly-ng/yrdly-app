import type { SupabaseClient } from '@supabase/supabase-js';
import { sendPushNotification } from '@/lib/server-push-notification';

export async function notifyCatalogItemOutOfStock(
  supabaseAdmin: SupabaseClient,
  params: { itemId: string; businessId: string; itemTitle: string },
): Promise<void> {
  try {
    const { data: business, error: businessError } = await supabaseAdmin
      .from('businesses')
      .select('owner_id')
      .eq('id', params.businessId)
      .maybeSingle();
    if (businessError) throw businessError;
    if (!business?.owner_id) return;

    const notification = {
      title: 'Item Out of Stock',
      message: `"${params.itemTitle}" is out of stock. Update its inventory to continue selling.`,
      data: { businessId: params.businessId, itemId: params.itemId, itemTitle: params.itemTitle },
    };
    const { data, error } = await supabaseAdmin.rpc('create_notification', {
      p_user_id: business.owner_id,
      p_type: 'catalog_item_out_of_stock',
      p_title: notification.title,
      p_message: notification.message,
      p_sender_id: null,
      p_related_id: params.itemId,
      p_related_type: 'catalog_item',
      p_data: notification.data,
    });
    if (error) throw error;

    const result = data as { should_push?: boolean; message?: string } | null;
    if (result?.should_push !== false) {
      await sendPushNotification(supabaseAdmin, business.owner_id, {
        title: notification.title,
        body: result?.message || notification.message,
        data: notification.data,
        url: `/businesses/${params.businessId}/catalog/${params.itemId}`,
      }, 'catalog_item_out_of_stock');
    }
  } catch (error) {
    // Inventory notifications must never roll back a completed payment.
    console.error('Could not notify business owner about out-of-stock catalog item:', error);
  }
}
