import { supabase } from './supabase';
import type { BusinessStaff } from '@/types';

export class StaffService {
  static async listStaff(businessId: string): Promise<BusinessStaff[]> {
    const { data, error } = await supabase.from('business_staff').select('*').eq('business_id', businessId).order('created_at');
    if (error) throw error;
    return data || [];
  }
  static async createStaff(businessId: string, p: { name: string; role?: string; avatar_url?: string; user_id?: string }): Promise<BusinessStaff> {
    const { data, error } = await supabase.from('business_staff').insert([{ business_id: businessId, ...p }]).select('*').single();
    if (error) throw error;
    return data;
  }
  static async updateStaff(id: string, updates: Partial<BusinessStaff>): Promise<BusinessStaff> {
    const { data, error } = await supabase.from('business_staff').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', id).select('*').single();
    if (error) throw error;
    return data;
  }
  static async deactivateStaff(id: string): Promise<void> {
    const { error } = await supabase.from('business_staff').update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
  }
  static async setServiceStaff(serviceId: string, staffIds: string[]): Promise<void> {
    await supabase.from('service_staff_assignments').delete().eq('service_id', serviceId);
    if (!staffIds.length) return;
    const rows = staffIds.map(sid => ({ service_id: serviceId, staff_id: sid }));
    const { error } = await supabase.from('service_staff_assignments').insert(rows);
    if (error) throw error;
  }
  static async getServiceStaff(serviceId: string): Promise<BusinessStaff[]> {
    const { data, error } = await supabase.from('service_staff_assignments').select('staff:business_staff(*)').eq('service_id', serviceId);
    if (error) throw error;
    return (data || []).map((r: any) => r.staff).filter(Boolean);
  }
}
