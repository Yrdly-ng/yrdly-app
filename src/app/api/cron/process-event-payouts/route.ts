import { NextRequest, NextResponse } from 'next/server';
import { EventEscrowService } from '@/lib/event-escrow-service';

/**
 * GET /api/cron/process-event-payouts
 * Secured Vercel Cron endpoint — runs daily to release matured escrow payouts.
 * Authorization: Bearer <CRON_SECRET>
 */
export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await EventEscrowService.processMaturedPayouts();

    console.log('[CRON] Event payouts processed:', result);

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      ...result,
    });
  } catch (error) {
    console.error('[CRON] Event payout processing failed:', error);
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}
