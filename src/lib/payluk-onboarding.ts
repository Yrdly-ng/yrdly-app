import { supabaseAdmin } from './supabase-admin';
import { PaylukService } from './payluk-service';

/**
 * Ensures a user has a Payluk customer profile.
 * - If `payluk_customer_id` is already set, returns it immediately.
 * - Otherwise, parses the user's name, creates a Payluk customer using the Nigeria countryId,
 *   saves the ID to the `users` table, and returns it.
 *
 * BVN Requirement Note:
 * Per Payluk docs, providing a BVN yields a permanent dedicated virtual account via Paystack,
 * whereas omitting it yields a 24-hour temporary account. We intentionally omit it here because:
 * 1. The `users` table does not currently collect or store BVNs.
 * 2. On Safe Haven (staging), BVNs require SMS OTP verification which cannot be automated via this API.
 * 3. Omitting it safely falls back to temporary accounts or the Payluk Test Bank.
 */
export async function ensurePaylukCustomer(userId: string): Promise<string> {
  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('payluk_customer_id, name, legal_name, email, phone')
    .eq('id', userId)
    .single();

  if (error || !user) {
    throw new Error(`[PaylukOnboarding] Failed to fetch user ${userId}: ${error?.message || 'User not found'}`);
  }

  // 1. Return immediately if already onboarded
  if (user.payluk_customer_id) {
    return user.payluk_customer_id;
  }

  // 2. Prepare customer data
  // The users table stores name as a single string. Payluk requires firstname and lastname.
  // We prioritize legal_name over name.
  const rawName = (user.legal_name || user.name || 'Unknown User').trim();
  const nameParts = rawName.split(/\s+/);
  
  const firstname = nameParts[0];
  // If the user only has a single-word name, fallback to 'User' since lastname is required
  const lastname = nameParts.length > 1 ? nameParts.slice(1).join(' ') : 'User';

  const email = user.email || `${userId}@placeholder.yrdly.com`;

  if (!user.phone) {
    throw new Error(
      `[PaylukOnboarding] User ${userId} must have a verified phone number before Payluk onboarding.`
    );
  }
  
  let phone = user.phone;
  if (phone.startsWith('234') && phone.length === 13) {
    phone = '0' + phone.substring(3);
  } else if (phone.startsWith('+234') && phone.length === 14) {
    phone = '0' + phone.substring(4);
  } else {
    phone = phone.replace(/\D/g, '');
    if (phone.length > 11) phone = phone.substring(phone.length - 11);
    if (phone.length < 11) phone = phone.padStart(11, '0');
    if (!phone.startsWith('0')) phone = '0' + phone.substring(1);
  }

  // 3. Call Payluk API
  const customer = await PaylukService.createCustomer({
    firstname,
    lastname,
    email,
    phone,
    countryId: '665f1b2c9a1e4d0012ab3c40', // Nigeria, fetched from get-countries.md
    // bvn is explicitly omitted as described in the doc header
  });

  // 4. Save to database
  const { error: updateError } = await supabaseAdmin
    .from('users')
    .update({ payluk_customer_id: customer.customerId })
    .eq('id', userId);

  if (updateError) {
    throw new Error(`[PaylukOnboarding] Failed to save Payluk customer ID: ${updateError.message}`);
  }

  return customer.customerId;
}
