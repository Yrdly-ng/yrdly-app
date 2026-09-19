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

export interface UserReportItem {
  id: string;
  user_id: string | null;
  category: string;
  subject: string;
  description: string;
  status: 'open' | 'resolved' | 'dismissed';
  image_url?: string;
  created_at: string;
}

export interface CommentReportItem {
  id: string;
  comment_id: string;
  post_id?: string;
  reporter_id: string;
  reason: string;
  created_at: string;
  status?: string;
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

  static async getUserReports(status: string = 'open', page: number = 1, limit: number = 20) {
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabase
      .from('reports')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (status !== 'all') {
      query = query.eq('status', status);
    }

    const { data, count, error } = await query;
    if (error) throw error;

    return { data: (data || []) as UserReportItem[], count: count || 0 };
  }

  static async updateUserReportStatus(reportId: string, status: 'resolved' | 'dismissed') {
    const { data, error } = await supabase
      .from('reports')
      .update({ status })
      .eq('id', reportId)
      .select();

    if (error) throw error;
    return data;
  }

  static async getCommentReports(page: number = 1, limit: number = 20) {
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, count, error } = await supabase
      .from('comment_reports')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) throw error;
    return { data: (data || []) as CommentReportItem[], count: count || 0 };
  }

  static async deleteReportedComment(commentId: string, reportId: string) {
    // Delete comment
    const { error: deleteErr } = await supabase
      .from('comments')
      .delete()
      .eq('id', commentId);

    if (deleteErr) console.warn('[ModerationAdminService] Comment delete warning:', deleteErr);

    // Delete or mark report as resolved
    const { error: reportErr } = await supabase
      .from('comment_reports')
      .delete()
      .eq('id', reportId);

    if (reportErr) throw reportErr;
  }

  static async dismissCommentReport(reportId: string) {
    const { error } = await supabase
      .from('comment_reports')
      .delete()
      .eq('id', reportId);

    if (error) throw error;
  }
}
