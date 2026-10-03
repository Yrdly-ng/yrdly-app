import { supabase } from './supabase';
import type { QuoteRequest, QuoteMessage } from '@/types';

export class QuoteService {
  static async createQuoteRequest(p: { business_id: string; category: string; title: string; description: string; images?: string[]; location_text?: string; urgency?: string; staff_id?: string | null }): Promise<QuoteRequest> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    const { data, error } = await supabase.from('quote_requests').insert([{ customer_id: user.id, business_id: p.business_id, category: p.category, title: p.title, description: p.description, images: p.images||[], location_text: p.location_text, urgency: p.urgency, staff_id: p.staff_id||null }]).select('*').single();
    if (error) throw error;
    return data;
  }
  static async listCustomerQuotes(): Promise<QuoteRequest[]> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    const { data, error } = await supabase.from('quote_requests').select('*').eq('customer_id', user.id).order('created_at', { ascending: false });
    if (error) throw error;
    return data||[];
  }
  static async listBusinessQuotes(businessId: string): Promise<QuoteRequest[]> {
    const { data, error } = await supabase.from('quote_requests').select('*').eq('business_id', businessId).order('created_at', { ascending: false });
    if (error) throw error;
    return data||[];
  }
  static async getQuote(id: string): Promise<QuoteRequest|null> {
    const { data, error } = await supabase.from('quote_requests').select('*').eq('id', id).single();
    if (error) return null;
    return data;
  }
  static async submitEstimate(id: string, p: { estimated_price: number; estimated_duration_minutes?: number; estimate_notes?: string; expires_at?: string }): Promise<QuoteRequest> {
    const { data, error } = await supabase.from('quote_requests').update({ estimated_price: p.estimated_price, estimated_duration_minutes: p.estimated_duration_minutes, estimate_notes: p.estimate_notes, expires_at: p.expires_at, status: 'estimated' }).eq('id', id).select('*').single();
    if (error) throw error;
    return data;
  }
  static async updateStatus(id: string, status: string): Promise<QuoteRequest> {
    const { data, error } = await supabase.from('quote_requests').update({ status }).eq('id', id).select('*').single();
    if (error) throw error;
    return data;
  }
  static async convertQuoteToBooking(quoteId: string, appointmentTime: string): Promise<{ booking: any; quote: QuoteRequest }> {
    const quote = await this.getQuote(quoteId);
    if (!quote) throw new Error('Quote not found');
    if (quote.status !== 'accepted' || !quote.estimated_price || quote.estimated_price < 1000) {
      throw new Error('Accept a valid estimate before converting it to a booking');
    }
    if (quote.expires_at && new Date(quote.expires_at).getTime() < Date.now()) {
      await this.updateStatus(quoteId, 'expired');
      throw new Error('This estimate has expired and cannot be converted');
    }
    // Create booking linked to quote. Business should have a service offering for quotes; we use a placeholder service or first active one.
    const { data: services } = await supabase.from('service_offerings').select('id, duration_minutes').eq('business_id', quote.business_id).eq('is_active', true).limit(1);
    const serviceId = services?.[0]?.id;
    if (!serviceId) throw new Error('No active service for business');
    const { data: { user } } = await supabase.auth.getUser();
    // import lazily to avoid circular
    const { BookingService } = await import('./booking-service');
    const booking = await BookingService.createBookingRequest({ customerId: user!.id, businessId: quote.business_id, serviceId, appointmentTime, staffId: quote.staff_id, quoteId });
    const { data: updated } = await supabase.from('quote_requests').update({ status: 'converted', converted_booking_id: booking.id }).eq('id', quoteId).select('*').single();
    return { booking, quote: updated };
  }
  // Messages
  static async listMessages(quoteId: string): Promise<QuoteMessage[]> {
    const { data, error } = await supabase.from('quote_messages').select('*').eq('quote_id', quoteId).order('created_at');
    if (error) throw error;
    return data||[];
  }
  static async sendMessage(quoteId: string, body: string): Promise<QuoteMessage> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    const { data, error } = await supabase.from('quote_messages').insert([{ quote_id: quoteId, sender_id: user.id, body }]).select('*').single();
    if (error) throw error;
    return data;
  }
}
