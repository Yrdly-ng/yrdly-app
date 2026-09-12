import { supabase } from './supabase';

export class ModerationService {
  /**
   * Check if a text is safe using the moderate-content Edge Function
   */
  static async checkText(text: string): Promise<{ isSafe: boolean; reason?: string }> {
    if (!text || text.trim() === '') return { isSafe: true };

    try {
      const { data, error } = await supabase.functions.invoke('moderate-content', {
        body: { type: 'text', content: text },
      });

      if (error) {
        console.error('[ModerationService] Error checking text:', error);
        return { isSafe: false, reason: 'moderation_error' };
      }

      return data;
    } catch (e) {
      console.error('[ModerationService] Exception checking text:', e);
      return { isSafe: false, reason: 'moderation_error' };
    }
  }
}
