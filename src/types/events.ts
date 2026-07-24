/**
 * TypeScript types for the Yrdly Event Ticketing System
 * Reflects the actual Supabase schema
 */

export type EventStatus = 'DRAFT' | 'PUBLISHED' | 'CANCELLED' | 'COMPLETED';
export type EventVisibility = 'PUBLIC' | 'WARD_ONLY' | 'LGA_ONLY' | 'UNLISTED';
export type EventPayoutMode = 'POST_EVENT';
export type TicketStatus = 'PAID' | 'USED' | 'REFUNDED' | 'CANCELLED';
export type EventPayoutStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface Event {
  id: string;
  organizer_id: string;
  title: string;
  description: string | null;
  category: string;
  cover_image_url: string | null;
  location_address: string | null;
  location_online: boolean;
  online_link: string | null;
  lat: number | null;
  lng: number | null;
  ward: string | null;
  lga: string | null;
  state: string | null;
  start_time: string;
  end_time: string | null;
  timezone: string;
  status: EventStatus;
  visibility: EventVisibility;
  payout_mode: EventPayoutMode;
  payout_released_at: string | null;
  payment_subaccount_id: string | null;
  published_at: string | null;
  scheduled_publish_at: string | null;
  attendee_count: number;
  created_at: string;
  updated_at: string;
  // Joined fields
  organizer?: {
    id: string;
    name: string;
    avatar_url?: string;
  };
  ticket_tiers?: TicketTier[];
}

export interface TicketTier {
  id: string;
  event_id: string;
  name: string;
  description: string | null;
  price: number; // In Naira (not kobo - matches DB numeric type)
  capacity: number | null;
  sold: number;
  is_visible: boolean;
  sale_ends_at: string | null;
  created_at: string;
  updated_at: string;
  // Computed
  available?: number;
  is_sold_out?: boolean;
  is_free?: boolean;
}

export interface Ticket {
  id: string;
  buyer_id: string;
  event_id: string;
  tier_id: string;
  attendee_name: string;
  attendee_email: string;
  attendee_phone: string | null;
  ticket_code: string;
  qr_data: string | null;
  status: TicketStatus;
  payment_tx_ref: string | null;
  payment_provider_ref: string | null;
  amount_paid: number;
  scanned_at: string | null;
  scanned_by: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  event?: Pick<Event, 'id' | 'title' | 'cover_image_url' | 'start_time' | 'location_address' | 'state'>;
  tier?: Pick<TicketTier, 'id' | 'name' | 'price'>;
}

export interface EventPayout {
  id: string;
  event_id: string;
  organizer_id: string;
  gross_amount: number;
  commission_amount: number;
  net_amount: number;
  payment_transfer_id: string | null;
  status: EventPayoutStatus;
  failure_reason: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

// ── API Payload Types ────────────────────────────────────────────────────────

export interface CreateEventPayload {
  title: string;
  description?: string;
  category?: string;
  cover_image_url?: string;
  location_address?: string;
  location_online?: boolean;
  online_link?: string;
  lat?: number;
  lng?: number;
  ward?: string;
  lga?: string;
  state?: string;
  start_time: string;
  end_time?: string;
  visibility?: EventVisibility;
  payout_mode?: EventPayoutMode;
  ticket_tiers: CreateTicketTierPayload[];
}

export interface CreateTicketTierPayload {
  name: string;
  description?: string;
  price: number; // 0 for free
  capacity?: number;
  is_visible?: boolean;
  sale_ends_at?: string;
}

export interface PurchaseTicketPayload {
  event_id: string;
  tier_id: string;
  attendee_name: string;
  attendee_email: string;
  attendee_phone?: string;
}

export interface CheckInPayload {
  ticket_code: string;
  event_id: string;
}
