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

  // 1. If already onboarded, verify the stored ID is still valid on Payluk
  if (user.payluk_customer_id) {
    try {
      await PaylukService.getCustomerById(user.payluk_customer_id);
      return user.payluk_customer_id; // confirmed valid
    } catch (verifyErr: any) {
      console.warn(
        `[PaylukOnboarding] Stored payluk_customer_id ${user.payluk_customer_id} is stale or invalid for user ${userId}: ${verifyErr?.message}. Re-creating...`
      );
      // Clear the stale ID so we fall through to re-creation
      await supabaseAdmin
        .from('users')
        .update({ payluk_customer_id: null })
        .eq('id', userId);
    }
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

  const email = user.email || `${userId}@placeholder.yrdly.com`;

  // 3. Call Payluk API
  let customerId = '';
  try {
    const customer = await PaylukService.createCustomer({
      firstname,
      lastname,
      email,
      phone,
    });
    customerId = customer.customerId;
  } catch (err: any) {
    // 1. Try extracting customerId directly from Payluk's error message (e.g., "registered to one of your customers (customerId: 6a905b7d4224347a5745b83c)")
    const match = err.message?.match(/customerId:\s*([a-f0-9]{24})/i);
    if (match && match[1]) {
      console.log(`[PaylukOnboarding] Extracted existing customerId ${match[1]} directly from Payluk error message.`);
      customerId = match[1];
    } else {
      const isAlreadyExistsError =
        err.message?.includes('already exists') ||
        err.message?.includes('already registered') ||
        err.message?.includes('registered to one of your customers');

      if (!isAlreadyExistsError) {
        throw err; // unrelated error — surface immediately
      }

      // "already exists" — try to recover the existing customer ID
      let existingCustomer = await PaylukService.getCustomerByPhone(phone, email);

      // Also try international format — Payluk may have stored the phone as 234XXXXXXXXX
      if (!existingCustomer && phone.startsWith('0') && phone.length === 11) {
        const intlPhone = '234' + phone.substring(1);
        console.log(`[PaylukOnboarding] Trying international phone format: ${intlPhone}`);
        existingCustomer = await PaylukService.getCustomerByPhone(intlPhone, email);
      }

      if (!existingCustomer) {
        console.log(`[PaylukOnboarding] Phone lookup failed for ${phone}, trying email: ${email}`);
        existingCustomer = await PaylukService.getCustomerByEmail(email);
      }

      if (!existingCustomer) {
        console.log(`[PaylukOnboarding] Email lookup failed, scanning all customers for phone: ${phone}`);
        existingCustomer = await PaylukService.findCustomerByPhoneOrEmailScan(phone, email);
      }

      // Last resort: match by name. This handles the case where a customer was
      // previously created with a placeholder email and a different phone number.
      if (!existingCustomer) {
        console.log(`[PaylukOnboarding] Scan failed, trying name-based recovery for: ${firstname} ${lastname}`);
        existingCustomer = await PaylukService.findCustomerByNameScan(firstname, lastname);
      }

      if (existingCustomer) {
        customerId = existingCustomer.customerId;
      } else {
        // Recovery failed — throw immediately.
        throw new Error(
          `[PaylukOnboarding] Customer already exists, but lookup by phone failed for ${phone}`
        );
      }
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
