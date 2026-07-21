import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from "@/lib/supabase-server";
import { supabaseAdmin } from '@/lib/supabase-admin';
import { createClient } from '@supabase/supabase-js';
import { PaystackService } from '@/lib/paystack-service';

/**
 * Normalises a name string for fuzzy comparison:
 * uppercase, strip punctuation/extra spaces.
 */
function normaliseName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Returns true if at least one significant word (>2 chars) from `a`
 * appears in `b`, or vice-versa.  Handles "JOHN DOE" vs "JOHN DOE JAMES".
 */
function namesMatch(a: string, b: string): boolean {
  const wordsA = normaliseName(a).split(' ').filter((w) => w.length > 2);
  const wordsB = normaliseName(b).split(' ').filter((w) => w.length > 2);
  return wordsA.some((w) => wordsB.includes(w));
}

/**
 * POST /api/seller/setup-account
 *
 * 1. Resolves the bank account via Paystack and verifies the name
 *    matches the authenticated user's profile name.
 * 2. Stores the account in `seller_accounts` with pending verification
 *    status and an `account_updated_at` timestamp for the cooling-off guard.
 */
export async function POST(request: NextRequest) {
  try {
    // ── Authenticate ─────────────────────────────────────
    const { data: { user }, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    const body = await request.json();
    const { bankCode, accountNumber, accountName } = body;

    if (!bankCode || !accountNumber || !accountName) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // ── Fetch user profile name for name-match check ─────
    const { data: profile } = await supabaseAdmin
      .from('users')
      .select('name')
      .eq('id', user.id)
      .single();

    const profileName = profile?.name || '';

    // ── Task 1: Paystack account resolution & name match ─
    const resolveResult = await PaystackService.resolveAccount(accountNumber, bankCode);

    if (resolveResult.valid && resolveResult.accountName) {
      const resolvedName = resolveResult.accountName;

      const isTestFallback = resolvedName.includes('(Fallback)');

      // Compare resolved bank name vs user-entered name
      if (!isTestFallback && !namesMatch(resolvedName, accountName)) {
        return NextResponse.json(
          {
            error: `Account name mismatch. The bank reports this account belongs to "${resolvedName}". Please use your own account.`,
            code: 'NAME_MISMATCH',
          },
          { status: 422 }
        );
      }

      // Also compare resolved bank name vs profile name (fraud guard)
      if (!isTestFallback && profileName && !namesMatch(resolvedName, profileName)) {
        return NextResponse.json(
          {
            error: `This bank account does not appear to belong to you. Please add an account registered in your own name.`,
            code: 'OWNERSHIP_MISMATCH',
          },
          { status: 422 }
        );
      }
    } else {
      // Paystack could not resolve — reject rather than skip the check
      console.warn('[AccountSetup] Paystack resolve failed');
      return NextResponse.json(
        { error: 'Could not verify account details. Please check your account number and bank, then try again.' },
        { status: 422 }
      );
    }

    let subaccountId: string | null = null; // We don't create Paystack subaccounts here yet

    // ── Deactivate any existing accounts ──────────────────
    // If this is an account update (not initial setup), mark the change time
    const { data: existingAccounts } = await supabaseAdmin
      .from('seller_accounts')
      .select('id')
      .eq('user_id', user.id)
      .eq('is_active', true);

    const isUpdate = existingAccounts && existingAccounts.length > 0;

    await supabaseAdmin
      .from('seller_accounts')
      .update({ is_primary: false, is_active: false, updated_at: new Date().toISOString() })
      .eq('user_id', user.id);

    // ── Store in seller_accounts ───────────────────────────
    // For initial setup: no account_updated_at (allows immediate selling)
    // For updates: set account_updated_at to trigger 48-hour cooling-off
    const now = new Date().toISOString();
    const { error: insertError } = await supabaseAdmin
      .from('seller_accounts')
      .insert({
        user_id: user.id,
        account_type: 'bank_account',
        account_details: {
          bank_code: bankCode,
          account_number: accountNumber,
          account_name: accountName,
        },
        verification_status: 'verified',
        is_active: true,
        is_primary: true,
        // ✅ Only set account_updated_at for account updates, not initial setup
        account_updated_at: isUpdate ? now : null,
        created_at: now,
        updated_at: now,
      });

    if (insertError) {
      console.error('Error storing seller account:', insertError);
      return NextResponse.json({ error: 'Failed to store account' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      subaccountId,
      message: 'Bank account linked and verified successfully.',
    });
  } catch (error) {
    console.error('Seller account setup error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * GET /api/seller/setup-account
 *
 * Returns the current seller's bank account info.
 */
export async function GET(request: NextRequest) {
  try {
    const { data: { user }, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    const { data, error } = await supabaseAdmin
      .from('seller_accounts')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .eq('is_primary', true)
      .maybeSingle();

    if (error) {
      console.error('Get seller account DB error:', error);
      return NextResponse.json({ account: null });
    }
    if (!data) {
      return NextResponse.json({ account: null });
    }

    const accountUpdatedAt = data.account_updated_at;
    const coolingOffEnds = accountUpdatedAt
      ? new Date(new Date(accountUpdatedAt).getTime() + 24 * 60 * 60 * 1000).toISOString()
      : null;
    const inCoolingOff = coolingOffEnds ? new Date() < new Date(coolingOffEnds) : false;

    const { data: failedPayoutsData } = await supabaseAdmin
      .from('payout_requests')
      .select('id, amount, failure_reason, requested_at')
      .eq('seller_id', user.id)
      .eq('status', 'failed')
      .order('requested_at', { ascending: false });

    return NextResponse.json({
      account: {
        accountName: data.account_details?.account_name || '',
        accountNumber: data.account_details?.account_number || '',
        bankCode: data.account_details?.bank_code || '',
        isVerified: data.verification_status === 'verified',
        inCoolingOff,
        coolingOffEnds,
        createdAt: data.created_at,
      },
      failedPayouts: failedPayoutsData || [],
    });
  } catch (error) {
    console.error('Get seller account error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
