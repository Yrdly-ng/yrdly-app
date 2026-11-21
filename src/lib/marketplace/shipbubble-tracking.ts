import { supabaseAdmin } from '@/lib/supabase/supabase-admin';
import type { QuoteConfig } from './shipbubble-quote';

export const shipmentStatuses = ['pending', 'confirmed', 'picked_up', 'in_transit', 'completed', 'cancelled'] as const;
export type ShipmentStatus = typeof shipmentStatuses[number];

export function shouldAdvanceShipment(current: string, incoming: ShipmentStatus) {
  if (current === 'completed' || current === 'cancelled') return false;
  return shipmentStatuses.indexOf(incoming) > shipmentStatuses.indexOf(current as ShipmentStatus);
}

const SHIPMENT_LIST = 'https://api.shipbubble.com/v1/shipping/labels';

export async function getShipbubbleStatus(config: QuoteConfig, shipmentId: string): Promise<ShipmentStatus | null> {
  const signal = AbortSignal.timeout(10_000);
  // The provider lists shipments in pages. Keep a manual refresh bounded.
  for (let page = 1; page <= 3; page++) {
    const response = await fetch(`${SHIPMENT_LIST}?Page=${page}&PerPage=50`, {
      headers: { Authorization: 'Bearer ' + config.key }, signal, redirect: 'error',
    });
    if (!response.ok) throw new Error('Shipbubble tracking unavailable');
    const envelope = await response.json();
    const results: unknown = envelope?.data?.results;
    if (envelope?.status !== 'success' || !Array.isArray(results)) throw new Error('Shipbubble tracking unavailable');
    const shipment = results.find(value => value?.order_id === shipmentId);
    if (shipment) return shipmentStatuses.includes(shipment.status) ? shipment.status : null;
    if (!results.length || !Number.isInteger(envelope?.data?.pagination?.next) || envelope.data.pagination.next <= page) return null;
  }
  return null;
}

export async function syncShipbubbleStatus(shipmentId: string, status: ShipmentStatus): Promise<boolean> {
  const table = supabaseAdmin.from('escrow_transactions');
  for (let attempt = 0; attempt < 3; attempt++) {
    const found = await table.select('id,status,delivery_details')
      .eq('delivery_details->>option', 'shipbubble').eq('delivery_details->>shipment_id', shipmentId).maybeSingle();
    if (found.error || !found.data) return false;
    const tx = found.data;
    const details = tx.delivery_details;
    if (!shouldAdvanceShipment(details.delivery_status, status)) return true;
    const now = new Date().toISOString();
    const updated = await table.update({
      delivery_details: { ...details, delivery_status: status },
      updated_at: now,
      ...(status === 'completed' && tx.status === 'paid' ? { status: 'shipped', shipped_at: now } : {}),
    }).eq('id', tx.id).eq('status', tx.status).eq('delivery_details->>shipment_id', shipmentId)
      .eq('delivery_details->>delivery_status', details.delivery_status).select('id').maybeSingle();
    if (updated.error) return false;
    if (updated.data) return true;
  }
  return false;
}
