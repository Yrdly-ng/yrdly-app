import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase/supabase-server';
import { supabaseAdmin } from '@/lib/supabase/supabase-admin';

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
      return NextResponse.json({ error: 'Unauthorized' }, { status: authError?.status === 403 ? 403 : authError?.status === 503 ? 503 : 401 });
    }

    const { data: adminProfile } = await supabaseAdmin
      .from('users')
      .select('is_admin,role')
      .eq('id', user.id)
      .maybeSingle();

    if (!adminProfile || (!adminProfile.is_admin && adminProfile.role !== 'admin')) {
      return NextResponse.json({ error: 'Forbidden: Admin privileges required' }, { status: 403 });
    }

    // 2. Parse Request Body
    let body: Record<string, unknown>;
    try {
      const parsed = await request.json();
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return NextResponse.json({ error: 'A valid request body is required.' }, { status: 400 });
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });
    }
    const targetUserId = typeof body.targetUserId === 'string' ? body.targetUserId : '';
    const action = typeof body.action === 'string' ? body.action : '';
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
    const reportId = typeof body.reportId === 'string' ? body.reportId : null;

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetUserId) || !['suspend', 'ban', 'unsuspend'].includes(action)) {
      return NextResponse.json(
        { error: 'A valid target account and action (suspend, ban, or unsuspend) are required.' },
        { status: 400 }
      );
    }
    if (targetUserId === user.id) {
      return NextResponse.json({ error: 'Admins cannot suspend or ban their own account.' }, { status: 400 });
    }
    if (reportId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reportId)) {
      return NextResponse.json({ error: 'Report reference is invalid.' }, { status: 400 });
    }

    // The transaction updates access and writes the immutable moderator audit row together.
    const { data: actionLogId, error: updateError } = await supabaseAdmin.rpc('admin_set_account_moderation', {
      p_actor_user_id: user.id,
      p_target_user_id: targetUserId,
      p_action: action,
      p_reason: reason || `Account action ${action} by admin ${user.id}`,
      p_report_id: reportId,
    });

    if (updateError) {
      console.error('[AdminUserSuspend] Database action error:', updateError);
      if (updateError.code === 'P0002') return NextResponse.json({ error: 'Target account was not found.' }, { status: 404 });
      if (updateError.code === '42501') return NextResponse.json({ error: 'Admin privileges required.' }, { status: 403 });
      return NextResponse.json({ error: 'Failed to update user status.' }, { status: 500 });
    }

    // The shared authentication helper enforces suspension on every server operation.
    // Supabase admin.signOut expects a user's access token, never a user UUID.

    return NextResponse.json({
      success: true,
      message: `Account ${action === 'unsuspend' ? 'restored' : action === 'ban' ? 'banned' : 'suspended'} successfully.`,
      targetUserId,
      action,
      actionLogId,
    });
  } catch (err: any) {
    console.error('[AdminUserSuspend] Error:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
