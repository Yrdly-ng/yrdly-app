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
  let { data: user, error } = await supabaseAdmin
    .from('users')
    .select('payluk_customer_id, name, legal_name, email, phone')
    .eq('id', userId)
    .maybeSingle();

  if (error || !user) {
    // Fallback to auth.users
    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (authError || !authUser?.user) {
      throw new Error(`[PaylukOnboarding] Failed to fetch user ${userId}: ${error?.message || 'User not found in public or auth'}`);
    }
    user = {
      payluk_customer_id: null,
      name: authUser.user.user_metadata?.name || 'Unknown',
      legal_name: null,
      email: authUser.user.email,
      phone: authUser.user.phone || authUser.user.user_metadata?.phone
    };
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

  // Use a platform-controlled email for Payluk customer creation.
  // We deliberately avoid the user's real email because:
  // 1. The Payluk merchant admin account may share the same email as a user,
  //    and Payluk refuses to create a "customer" with the same email as the admin.
  // 2. This guarantees uniqueness across all users regardless of their real email.
  const paylukEmail = `user-${userId}@users.yrdly.ng`;

  // 3. Call Payluk API
  // Two-attempt strategy:
  //   Attempt 1: with phone — normal path.
  //   Attempt 2: without phone — handles the edge case where the user's phone
  //              is already registered as the Payluk merchant admin phone, which
  //              Payluk refuses to register again as a customer phone. Without a
  //              phone the customer is still valid; phone verification is separate.
  let customerId = '';
  const createAttempts: Array<{ phone?: string }> = [{ phone }, {}];

  for (const extra of createAttempts) {
    try {
      const customer = await PaylukService.createCustomer({
        firstname,
        lastname,
        email: paylukEmail,
        ...extra,
      });
      customerId = customer.customerId;
      break; // success
    } catch (err: any) {
      if (!err.message?.includes('already exists under this merchant')) {
        throw err; // unrelated error — surface immediately
      }

      // "already exists" — try to recover the existing customer ID
      let existingCustomer = await PaylukService.getCustomerByPhone(phone);

      if (!existingCustomer) {
        console.log(`[PaylukOnboarding] Phone lookup failed for ${phone}, trying platform email: ${paylukEmail}`);
        existingCustomer = await PaylukService.getCustomerByEmail(paylukEmail);
      }

      if (!existingCustomer) {
        console.log(`[PaylukOnboarding] Email lookup failed, scanning all customers for phone: ${phone}`);
        existingCustomer = await PaylukService.findCustomerByPhoneOrEmailScan(phone, paylukEmail);
      }

      if (existingCustomer) {
        customerId = existingCustomer.customerId;
        break;
      }

      // Recovery failed — continue to next attempt (phone-omitted) if available
      if (extra.phone === undefined) {
        // Already tried without phone and still failed
        throw new Error(
          `[PaylukOnboarding] Customer already exists, but lookup by phone failed for ${phone}`
        );
      }
      console.log(`[PaylukOnboarding] Retrying customer creation without phone for ${phone}`);
    }
  }

  // 4. Save to database
  const { error: updateError } = await supabaseAdmin
    .from('users')
    .update({ payluk_customer_id: customerId })
    .eq('id', userId);

  if (updateError) {
    throw new Error(`[PaylukOnboarding] Failed to save Payluk customer ID: ${updateError.message}`);
  }

  return customerId;
}
