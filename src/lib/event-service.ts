/**
 * Event Service — all Supabase interactions for the events & ticketing system.
 * Server-side safe (no Paystack SDK usage here).
 */

import { supabase } from './supabase';
import type { Event, TicketTier, Ticket, EventPayout } from '@/types/events';
import { EVENT_CONSTANTS } from '@/lib/constants';

const EVENT_COMMISSION = EVENT_CONSTANTS.COMMISSION_RATE;

// ── PUBLIC QUERIES ────────────────────────────────────────────────────────────

export async function getPublishedEvents(opts?: {
  state?: string;
  lga?: string;
  ward?: string;
  category?: string;
  limit?: number;
}): Promise<Event[]> {
  let query = supabase
    .from('events')
    .select(`
      *,
      organizer:users!events_organizer_id_fkey(id, name, avatar_url),
      ticket_tiers(*)
    `)
    .eq('status', 'PUBLISHED')
    .or(`end_time.gte.${new Date().toISOString()},start_time.gte.${new Date().toISOString()}`)
    .order('start_time', { ascending: true });

  if (opts?.state) query = query.eq('state', opts.state);
  if (opts?.lga) query = query.eq('lga', opts.lga);
  if (opts?.ward) query = query.eq('ward', opts.ward);
  if (opts?.category) query = query.eq('category', opts.category);
  if (opts?.limit) query = query.limit(opts.limit);

  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(enrichEventTiers);
}

export async function getEventById(id: string): Promise<Event | null> {
  const { data, error } = await supabase
    .from('events')
    .select(`
      *,
      organizer:users!events_organizer_id_fkey(id, name, avatar_url),
      ticket_tiers(*)
    `)
    .eq('id', id)
    .single();

  if (error) return null;
  return enrichEventTiers(data);
}

export async function getOrganizerEvents(organizerId: string): Promise<Event[]> {
  const { data, error } = await supabase
    .from('events')
    .select(`*, ticket_tiers(*)`)
    .eq('organizer_id', organizerId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []).map(enrichEventTiers);
}

// ── TICKET QUERIES ────────────────────────────────────────────────────────────

export async function getMyTickets(userId: string): Promise<Ticket[]> {
  const { data, error } = await supabase
    .from('tickets')
    .select(`
      *,
      event:events(id, title, cover_image_url, start_time, end_time, location_address, location_online, online_link, status),
      tier:ticket_tiers(id, name, price)
    `)
    .eq('buyer_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function getTicketByToken(ticketId: string): Promise<Ticket | null> {
  const { data, error } = await supabase
    .from('tickets')
    .select(`
      *,
      event:events(id, title, cover_image_url, start_time, end_time, location_address, status),
      tier:ticket_tiers(id, name, price)
    `)
    .eq('id', ticketId)
    .single();

  if (error) return null;
  return data;
}

export async function getEventTickets(eventId: string): Promise<Ticket[]> {
  const { data, error } = await supabase
    .from('tickets')
    .select(`*, tier:ticket_tiers(id, name, price)`)
    .eq('event_id', eventId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

// ── EVENT PAYOUT HELPERS ──────────────────────────────────────────────────────

export function calculateEventPayout(grossAmount: number) {
  const commission = Math.round(grossAmount * EVENT_COMMISSION * 100) / 100;
  const net = Math.round((grossAmount - commission) * 100) / 100;
  return { gross: grossAmount, commission, net };
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

function enrichEventTiers(event: any): Event {
  if (!event.ticket_tiers) return event;
  return {
    ...event,
    ticket_tiers: event.ticket_tiers.map((t: TicketTier) => ({
      ...t,
      available: t.capacity == null ? null : Math.max(0, t.capacity - t.sold),
      is_sold_out: t.capacity != null && t.sold >= t.capacity,
    })),
  };
}
