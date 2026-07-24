import { supabase } from './supabase';

export class UserActivityService {
  // Update user's last seen timestamp
  static async updateUserActivity(userId: string) {
    try {
      const { error } = await supabase
        .from('users')
        .update({ 
          last_seen: new Date().toISOString(),
          is_online: true
        })
        .eq('id', userId);

      if (error) {
        console.error('Error updating user activity:', error);
      }
    } catch (error) {
      console.error('Error updating user activity:', error);
    }
  }

  // Get users active in the last 24 hours
  static async getActiveUsersCount(hours: number = 24): Promise<number> {
    try {
      const cutoffTime = new Date();
      cutoffTime.setHours(cutoffTime.getHours() - hours);
      
      const { data, error } = await supabase
        .from('users')
        .select('id, last_seen')
        .gte('last_seen', cutoffTime.toISOString());

      if (error) {
        console.error('Error fetching active users:', error);
        return 0;
      }

      return data?.length || 0;
    } catch (error) {
      console.error('Error fetching active users:', error);
      return 0;
    }
  }

  // Get users active today (since midnight)
  static async getActiveTodayCount(): Promise<number> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Start of today
      
      const { data, error } = await supabase
        .from('users')
        .select('id, last_seen')
        .gte('last_seen', today.toISOString());

      if (error) {
        console.error('Error fetching active users today:', error);
        return 0;
      }

      return data?.length || 0;
    } catch (error) {
      console.error('Error fetching active users today:', error);
      return 0;
    }
  }
}
