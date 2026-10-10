import { authenticatedFetch } from './authenticated-fetch';

export class PushNotificationService {
  /** The server chooses both recipient and content for this self-test. */
  static async testNotification(_userId: string): Promise<boolean> {
    try {
      const result = await authenticatedFetch<{ success:boolean }>('/api/notifications/test',{});
      return result.success;
    } catch (error) { console.error('Push self-test failed:',error);return false; }
  }
}
