import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ResendEmailService } from '@/lib/resend-service';
import { emailTemplates } from '@/lib/email-templates';

// We must use the service role key to bypass Row Level Security 
// and read all users' notifications.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(request: Request) {
  // Optional: Verify a cron secret to prevent unauthorized execution
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    // 1. Find users who have unread notifications from the last 24 hours
    // We only want to notify them if they haven't been notified recently.
    // For simplicity, we just look at notifications created in the last 24h.
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: recentNotifications, error: notifError } = await supabaseAdmin
      .from('notifications')
      .select('user_id')
      .eq('is_read', false)
      .gte('created_at', twentyFourHoursAgo);

    if (notifError) throw notifError;

    if (!recentNotifications || recentNotifications.length === 0) {
      return NextResponse.json({ message: 'No unread notifications to send.' });
    }

    // 2. Group by user_id to count them
    const userNotifCounts: Record<string, number> = {};
    for (const notif of recentNotifications) {
      userNotifCounts[notif.user_id] = (userNotifCounts[notif.user_id] || 0) + 1;
    }

    const userIds = Object.keys(userNotifCounts);

    // 3. Get the email addresses and names of these users
    const { data: users, error: usersError } = await supabaseAdmin
      .from('users')
      .select('id, name, email')
      .in('id', userIds);

    if (usersError) throw usersError;

    // 4. Send emails
    const emailsSent = [];
    for (const user of users || []) {
      const count = userNotifCounts[user.id];
      if (count > 0 && user.email) {
        const template = emailTemplates.digestReminder(user.name || 'User', 0, count);
        
        // Use the ResendEmailService
        await ResendEmailService.sendEmail(
          user.email,
          template.subject,
          template.html,
          'digest-reminder'
        );

        emailsSent.push(user.email);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Sent reminders to ${emailsSent.length} users.`,
      emails: emailsSent
    });

  } catch (error: any) {
    console.error('Error sending digest reminders:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
