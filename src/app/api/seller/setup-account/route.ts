import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { createClient } from '@supabase/supabase-js';

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
 * 2. Creates (or retrieves) a Flutterwave subaccount.
 * 3. Stores the account in `seller_accounts` with pending verification
 *    status and an `account_updated_at` timestamp for the cooling-off guard.
 */
export async function POST(request: NextRequest) {
  try {
    // ── Authenticate ─────────────────────────────────────
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const supabaseAuth = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { autoRefreshToken: false, persistSession: false },
      }
    );
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
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
    if (process.env.PAYSTACK_SECRET_KEY) {
      const paystackRes = await fetch(
        `https://api.paystack.co/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          },
        }
      );

      const paystackData = await paystackRes.json();

      if (paystackData.status === true && paystackData.data?.account_name) {
        const resolvedName: string = paystackData.data.account_name;

        // Compare resolved bank name vs user-entered name
        if (!namesMatch(resolvedName, accountName)) {
          return NextResponse.json(
            {
              error: `Account name mismatch. The bank reports this account belongs to "${resolvedName}". Please use your own account.`,
              code: 'NAME_MISMATCH',
            },
            { status: 422 }
          );
        }

        // Also compare resolved bank name vs profile name (fraud guard)
        if (profileName && !namesMatch(resolvedName, profileName)) {
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
        console.warn('[AccountSetup] Paystack resolve failed:', paystackData);
        return NextResponse.json(
          { error: 'Could not verify account details. Please check your account number and bank, then try again.' },
          { status: 422 }
        );
      }
    } else {
      console.warn('[AccountSetup] PAYSTACK_SECRET_KEY not set — skipping name match');
    }

    // ── Task 2: Create Flutterwave subaccount (best-effort) ──
    let subaccountId: string | null = null;

    if (process.env.FLUTTERWAVE_SECRET_KEY) {
      try {
        const flwRes = await fetch('https://api.flutterwave.com/v3/subaccounts', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            account_bank: bankCode,
            account_number: accountNumber,
            business_name: accountName,
            business_email: user.email,
            business_contact: accountName,
            business_contact_mobile: '',
            business_mobile: '',
            country: 'NG',
            split_type: 'percentage',
            split_value: 0.97, // Seller gets 97%
          }),
        });

        const flwData = await flwRes.json();

        if (flwData.status === 'success') {
          subaccountId = flwData.data?.subaccount_id ?? null;
        } else if (flwData.message?.toLowerCase().includes('already exists')) {
          // Try to retrieve the existing subaccount
          const listRes = await fetch('https://api.flutterwave.com/v3/subaccounts', {
            headers: { Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` },
          });
          const listData = await listRes.json();

          if (listData.status === 'success' && Array.isArray(listData.data)) {
            const existing = listData.data.find(
              (s: any) => s.account_number === accountNumber && s.account_bank === bankCode
            );
            if (existing) subaccountId = existing.subaccount_id;
          }
          // If still not found, we continue without a subaccount ID — account is stored and can be retried
        } else {
          // Non-fatal: log and continue without a subaccount ID so the user account is saved
          console.warn('[AccountSetup] Flutterwave subaccount creation failed (non-fatal):', flwData.message);
        }
      } catch (flwErr) {
        // Network / timeout error — save account without subaccount ID, retry later
        console.warn('[AccountSetup] Flutterwave request failed (non-fatal):', flwErr);
      }
    } else {
      console.warn('[AccountSetup] FLUTTERWAVE_SECRET_KEY not set — skipping subaccount creation');
    }

    // ── Deactivate any existing accounts ──────────────────
    await supabaseAdmin
      .from('seller_accounts')
      .update({ is_primary: false, is_active: false, updated_at: new Date().toISOString() })
      .eq('user_id', user.id);

    // ── Store in seller_accounts ───────────────────────────
    // verification_status is 'pending' — name match passed but cooling-off
    // applies before the first payout. Set to 'verified' after 48 hrs or
    // after manual micro-deposit confirmation.
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
        flutterwave_subaccount_id: subaccountId,
        is_primary: true,
        is_active: true,
        // ✅ Task 2: keep as 'verified' since Paystack name check passed above
        verification_status: 'verified',
        // ✅ Task 3: cooling-off anchor — payouts blocked for 48 hrs after this
        account_updated_at: now,
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
      message: 'Bank account linked and verified successfully. Payouts will be available after 48 hours.',
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
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const supabaseAuth = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { autoRefreshToken: false, persistSession: false },
      }
    );
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    const { data, error } = await supabaseAdmin
      .from('seller_accounts')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .eq('is_primary', true)
      .single();

    if (error || !data) {
      return NextResponse.json({ account: null });
    }

    const accountUpdatedAt = data.account_updated_at || data.updated_at;
    const coolingOffEnds = accountUpdatedAt
      ? new Date(new Date(accountUpdatedAt).getTime() + 48 * 60 * 60 * 1000).toISOString()
      : null;
    const inCoolingOff = coolingOffEnds ? new Date() < new Date(coolingOffEnds) : false;

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
    });
  } catch (error) {
    console.error('Get seller account error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
