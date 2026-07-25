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
  const events = (data || []).map(enrichEventTiers);

  if (events.length > 0) {
    const eventIds = events.map(e => e.id);
    try {
      const { data: ticketsData } = await supabase
        .from('tickets')
        .select('event_id, buyer:users(id, name, avatar_url)')
        .in('event_id', eventIds)
        .eq('status', 'PAID')
        .limit(100);

      if (ticketsData) {
        const attendeesByEvent: Record<string, Array<{ id: string; name?: string; avatar_url?: string }>> = {};
        const seenByEvent: Record<string, Set<string>> = {};

        for (const t of ticketsData) {
          const eid = (t as any).event_id;
          const buyer = (t as any).buyer;
          if (eid && buyer && buyer.id) {
            if (!attendeesByEvent[eid]) attendeesByEvent[eid] = [];
            if (!seenByEvent[eid]) seenByEvent[eid] = new Set();

            if (!seenByEvent[eid].has(buyer.id) && attendeesByEvent[eid].length < 5) {
              seenByEvent[eid].add(buyer.id);
              attendeesByEvent[eid].push({
                id: buyer.id,
                name: buyer.name,
                avatar_url: buyer.avatar_url,
              });
            }
          }
        }

        events.forEach(e => {
          e.attendees = attendeesByEvent[e.id] || [];
        });
      }
    } catch (e) {
      console.warn('Failed to batch fetch attendees:', e);
    }
  }

  return events;
}

export async function getEventAttendees(eventId: string, limit: number = 5) {
  try {
    const { data } = await supabase
      .from('tickets')
      .select('buyer:users(id, name, avatar_url)')
      .eq('event_id', eventId)
      .eq('status', 'PAID')
      .limit(limit * 3);

    if (!data) return [];
    
    const seen = new Set<string>();
    const attendees: Array<{ id: string; name?: string; avatar_url?: string }> = [];
    for (const item of data) {
      const buyer = (item as any).buyer;
      if (buyer && buyer.id && !seen.has(buyer.id)) {
        seen.add(buyer.id);
        attendees.push({
          id: buyer.id,
          name: buyer.name,
          avatar_url: buyer.avatar_url,
        });
        if (attendees.length >= limit) break;
      }
    }
    return attendees;
  } catch (err) {
    console.warn('Error fetching event attendees:', err);
    return [];
  }
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
  const event = enrichEventTiers(data);
  if (event) {
    event.attendees = await getEventAttendees(id, 5);
  }
  return event;
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
