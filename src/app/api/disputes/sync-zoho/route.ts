import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { ZohoService } from '@/lib/zoho-service';

export async function POST(request: Request) {
  try {
    const { data: { user }, error: authError } = await getAuthenticatedUser(request as any);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { disputeId } = body;

    if (!disputeId) {
      return NextResponse.json({ error: 'Missing disputeId' }, { status: 400 });
    }

    // Fetch dispute and user details
    const { data: dispute, error: disputeError } = await supabaseAdmin
      .from('disputes')
      .select(`
        *,
        transaction:escrow_transactions(
          id,
          buyer_id,
          seller_id,
          item:posts(title, text)
        ),
        user:users!opened_by(email, name)
      `)
      .eq('id', disputeId)
      .single();

    if (disputeError || !dispute) {
      return NextResponse.json({ error: 'Dispute not found' }, { status: 404 });
    }

    const transaction = Array.isArray(dispute.transaction) ? dispute.transaction[0] : dispute.transaction;
    const item = Array.isArray(transaction.item) ? transaction.item[0] : transaction.item;
    const itemTitle = item?.title || item?.text || 'Unknown Item';
    const contactName = dispute.user?.name || 'Yrdly User';
    
    // Create Zoho Ticket
    let ticketId = '';
    try {
      ticketId = await ZohoService.createTicket({
        subject: `Dispute: ${itemTitle} (Transaction #${transaction.id.split('-')[0]})`,
        description: `Dispute Reason: ${dispute.dispute_reason}\n\nEvidence provided. View admin dashboard to resolve.`,
        contactName: contactName,
        email: dispute.user?.email || user.email || 'no-reply@yrdly.ng',
      });
      
      // Optionally store the ticket ID in the database if you added a column for it
      // For now, we just create it so the team can see it in Zoho.
      
    } catch (zohoError) {
      console.error('Failed to create Zoho ticket:', zohoError);
      // We don't fail the whole dispute creation just because Zoho is down
      return NextResponse.json({ success: true, warning: 'Dispute opened but Zoho ticket creation failed' });
    }

    return NextResponse.json({ success: true, ticketId });

  } catch (error) {
    console.error('Sync Zoho API error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
