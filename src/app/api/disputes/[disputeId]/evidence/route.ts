import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';

const evidenceSchema = z.object({
  description: z.string().trim().max(4000).optional(),
  photos: z.array(z.string().min(1).max(1024)).max(5).optional(),
  chatScreenshots: z.array(z.string().min(1).max(1024)).max(5).optional(),
  additionalNotes: z.string().trim().max(2000).optional(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ disputeId: string }> },
) {
  const { data: { user }, error: authError } = await getAuthenticatedUser(request);
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { disputeId } = await context.params;
  const parsed = evidenceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid evidence.' }, { status: 400 });

  const { data: dispute } = await supabaseAdmin
    .from('disputes')
    .select('id, transaction_id, status')
    .eq('id', disputeId)
    .maybeSingle();
  if (!dispute) return NextResponse.json({ error: 'Dispute not found.' }, { status: 404 });

  const { data: transaction } = await supabaseAdmin
    .from('escrow_transactions')
    .select('buyer_id, seller_id')
    .eq('id', dispute.transaction_id)
    .maybeSingle();
  if (!transaction || (user.id !== transaction.buyer_id && user.id !== transaction.seller_id)) {
    return NextResponse.json({ error: 'You are not a party to this dispute.' }, { status: 403 });
  }
  if (!['open', 'under_review'].includes(dispute.status)) {
    return NextResponse.json({ error: 'Evidence can only be added to an open dispute.' }, { status: 409 });
  }

  const { photos = [], chatScreenshots = [], ...details } = parsed.data;
  for (const path of [...photos, ...chatScreenshots]) {
    if (!path.startsWith(`${dispute.transaction_id}/${user.id}/`)) {
      return NextResponse.json({ error: 'Evidence files must belong to this transaction and your account.' }, { status: 400 });
    }
    const { error } = await supabaseAdmin.storage.from('dispute-evidence').createSignedUrl(path, 30);
    if (error) return NextResponse.json({ error: 'One or more evidence files could not be verified.' }, { status: 400 });
  }

  const { error: updateError } = await supabaseAdmin.rpc('append_dispute_evidence', {
    p_dispute_id: disputeId,
    p_user_id: user.id,
    p_evidence: { ...details, photos, chatScreenshots },
  });
  if (updateError) {
    console.error('[DisputeEvidenceAPI] Evidence update failed:', updateError);
    return NextResponse.json({ error: 'Could not save evidence.' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
