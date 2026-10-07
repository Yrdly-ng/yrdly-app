import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/users/suspend
 * Allows an admin to suspend, ban, or unsuspend a user account.
 */
export async function POST(request: NextRequest) {
  try {
    // 1. Verify Admin Authentication
    const { data: { user }, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: adminProfile } = await supabaseAdmin
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .maybeSingle();

    if (!adminProfile || !adminProfile.is_admin) {
      return NextResponse.json({ error: 'Forbidden: Admin privileges required' }, { status: 403 });
    }

    // 2. Parse Request Body
    const { targetUserId, action, reason } = await request.json();

    if (!targetUserId || !['suspend', 'ban', 'unsuspend'].includes(action)) {
      return NextResponse.json(
        { error: 'Missing required fields: targetUserId, action ("suspend" | "ban" | "unsuspend")' },
        { status: 400 }
      );
    }

    // 3. Perform Suspension / Ban Action
    let updatePayload: Record<string, any> = {};

    if (action === 'suspend') {
      updatePayload = {
        is_suspended: true,
        status: 'suspended',
        suspension_reason: reason || 'Suspended by admin',
        suspended_at: new Date().toISOString(),
      };
    } else if (action === 'ban') {
      updatePayload = {
        is_suspended: true,
        is_banned: true,
        status: 'banned',
        suspension_reason: reason || 'Banned by admin',
        suspended_at: new Date().toISOString(),
      };
    } else if (action === 'unsuspend') {
      updatePayload = {
        is_suspended: false,
        is_banned: false,
        status: 'active',
        suspension_reason: null,
        suspended_at: null,
      };
    }

    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update(updatePayload)
      .eq('id', targetUserId);

    if (updateError) {
      console.error('[AdminUserSuspend] Database update error:', updateError);
      return NextResponse.json({ error: 'Failed to update user status' }, { status: 500 });
    }

    // 4. Force sign-out target user sessions if suspended or banned
    if (action === 'suspend' || action === 'ban') {
      try {
        await supabaseAdmin.auth.admin.signOut(targetUserId);
      } catch (signOutErr) {
        console.warn('[AdminUserSuspend] Session signout warning:', signOutErr);
      }
    }

    return NextResponse.json({
      success: true,
      message: `User ${targetUserId} has been ${action}ed successfully.`,
      targetUserId,
      action,
    });
  } catch (err: any) {
    console.error('[AdminUserSuspend] Error:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
