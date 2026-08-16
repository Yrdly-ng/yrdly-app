import { supabase } from './supabase';

export interface ModerationQueueItem {
  id: string;
  content_id: string;
  table_name: string;
  user_id: string;
  status: 'pending' | 'approved' | 'rejected';
  reason: string;
  text_content?: string;
  image_urls?: string[];
  created_at: string;
  updated_at: string;
}

export class ModerationAdminService {
  static async getQueue(status: string = 'pending', page: number = 1, limit: number = 20) {
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabase
      .from('moderation_queue')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (status !== 'all') {
      query = query.eq('status', status);
    }

    const { data, count, error } = await query;
    
    if (error) throw error;
    
    return { data: data as ModerationQueueItem[], count: count || 0 };
  }

  static async moderateContent(queueId: string, action: 'approve' | 'reject') {
    const { data, error } = await supabase.functions.invoke('admin-moderate', {
      body: { queue_id: queueId, decision: action === 'approve' ? 'approved' : 'rejected' },
    });

    if (error) throw error;
    return data;
  }
}
