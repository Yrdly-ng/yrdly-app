import { supabase } from './supabase';
import type { StrikeAppeal } from '@/types';
import { BookingService } from './booking-service';
import { NotificationTriggers } from './notification-triggers';

export class AppealService {
  static async createAppeal(p: { booking_id: string; appellant_type: 'customer'|'provider'; reason: string; evidence_urls?: string[] }): Promise<StrikeAppeal> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    const { data, error } = await supabase.from('strike_appeals').insert([{ booking_id: p.booking_id, appellant_id: user.id, appellant_type: p.appellant_type, reason: p.reason, evidence_urls: p.evidence_urls||[] }]).select('*').single();
    if (error) throw error;
    return data;
  }
  static async listMyAppeals(): Promise<StrikeAppeal[]> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    const { data, error } = await supabase.from('strike_appeals').select('*').eq('appellant_id', user.id).order('created_at', { ascending: false });
    if (error) throw error;
    return data||[];
  }
  static async listAllAppeals(): Promise<StrikeAppeal[]> {
    const { data, error } = await supabase.from('strike_appeals').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data||[];
  }
  static async reviewAppeal(id: string, decision: 'approved'|'rejected', resolution_note?: string): Promise<StrikeAppeal> {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: appeal, error: fetchErr } = await supabase.from('strike_appeals').select('*').eq('id', id).single();
    if (fetchErr || !appeal) throw new Error('Appeal not found');
    const { data, error } = await supabase.from('strike_appeals').update({ status: decision, reviewed_by: user?.id||null, reviewed_at: new Date().toISOString(), resolution_note: resolution_note||null }).eq('id', id).select('*').single();
    if (error) throw error;
    await NotificationTriggers.onAppealDecided({
      appealId: appeal.id,
      bookingId: appeal.booking_id,
      appellantId: appeal.appellant_id,
      decision,
      resolutionNote: resolution_note,
    });
    if (decision === 'approved') {
      // Decrement counts and re-evaluate flag for the struck party stored on booking
      const { data: booking } = await supabase.from('bookings').select('customer_id, business_id, strike_party, strike_type').eq('id', appeal.booking_id).single();
      if (booking?.strike_party && booking.strike_type) {
        const targetId = booking.strike_party === 'customer' ? booking.customer_id : booking.business_id;
        await BookingService.evaluateActiveFlagStatus(targetId, booking.strike_party as any);
        // Optionally revert booking status from late_cancelled/no_show to cancelled if needed (keep as-is for history)
      }
    }
    return data;
  }
  static async listFlaggedUsers(): Promise<any[]> {
    const { data, error } = await supabase.from('users').select('id, name, avatar_url, is_flagged, no_show_count, late_cancellation_count').eq('is_flagged', true).limit(50);
    if (error) throw error;
    return data||[];
  }
  static async listFlaggedBusinesses(): Promise<any[]> {
    const { data, error } = await supabase.from('businesses').select('id, name, is_flagged, no_show_count, late_cancellation_count').eq('is_flagged', true).limit(50);
    if (error) throw error;
    return data||[];
  }
}
