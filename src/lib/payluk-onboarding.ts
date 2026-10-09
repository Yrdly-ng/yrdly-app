import { supabaseAdmin } from './supabase-admin';
import { PaylukService, type PaylukCustomer } from './payluk-service';

function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (/^234[789]\d{9}$/.test(digits)) return `0${digits.slice(3)}`;
  if (/^0[789]\d{9}$/.test(digits)) return digits;
  throw new Error('A verified Nigerian phone number is required for payments.');
}

export async function getPaylukCustomerId(userId: string): Promise<string> {
  return ensurePaylukCustomer(userId);
}

/** Never recover a financial identity by name or unverified profile email. */
export async function ensurePaylukCustomer(userId: string): Promise<string> {
  const deadline = AbortSignal.timeout(10_000);
  const { data: user, error } = await supabaseAdmin.from('users')
    .select('payluk_customer_id, name, legal_name, phone, phone_verified')
    .eq('id', userId).single();
  if (error || !user) throw new Error('Payment profile could not be loaded. Please retry.');
  if (!user.phone_verified || !user.phone) throw new Error('Verify your phone number before using payments.');
  const phone = normalizePhone(user.phone);
  const validate = async (customer: PaylukCustomer) => {
    if (!customer?.customerId || normalizePhone(customer.phone || '') !== phone) {
      throw new Error('Payment identity could not be verified. Contact support; your stored mapping has not been changed.');
    }
    const { data: duplicate, error: lookupError } = await supabaseAdmin.from('users')
      .select('id').eq('payluk_customer_id', customer.customerId).neq('id', userId).limit(1);
    if (lookupError) throw new Error('Unable to verify payment identity. Please retry.');
    if (duplicate?.length) throw new Error('Payment identity is already linked to another account. Contact support.');
    deadline.throwIfAborted();
    return customer.customerId;
  };
  if (user.payluk_customer_id) {
    return validate(await PaylukService.getCustomerById(user.payluk_customer_id, deadline));
  }
  let customer = await PaylukService.getCustomerByPhone(phone, undefined, deadline);
  if (!customer) {
    const { data: auth, error: authError } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (authError || !auth.user?.email || !auth.user.email_confirmed_at) {
      throw new Error('Verify your email before setting up payments.');
    }
    const [firstname, ...rest] = (user.legal_name || user.name || 'Yrdly User').trim().split(/\s+/);
    customer = await PaylukService.createCustomer({ firstname, lastname: rest.join(' ') || 'User', email: auth.user.email, phone }, deadline);
  }
  const customerId = await validate(customer);
  const { data: saved, error: saveError } = await supabaseAdmin.from('users')
    .update({ payluk_customer_id: customerId }).eq('id', userId)
    .is('payluk_customer_id', null).select('payluk_customer_id').maybeSingle();
  if (saveError) throw new Error('Unable to save verified payment identity. Please retry.');
  if (!saved) {
    const { data: current, error: readError } = await supabaseAdmin.from('users')
      .select('payluk_customer_id').eq('id', userId).single();
    if (readError || current?.payluk_customer_id !== customerId) throw new Error('Payment identity changed concurrently. Contact support.');
  }
  return customerId;
}
