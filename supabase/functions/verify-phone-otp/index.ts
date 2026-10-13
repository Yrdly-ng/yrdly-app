import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { authorize, normalizePhone, preflight, rateLimit, readBody, reply, termii } from '../_shared/phone-otp.ts';

serve(async req => {
  const early = preflight(req);
  if (early) return early;
  try {
    const actor = await authorize(req);
    if (actor.error) return actor.error;
    let input;
    try { input = await readBody(req); } catch { return reply({ error: 'Invalid request body' }, 400); }
    const { pinId, pin } = input;
    if (typeof pinId !== 'string' || !pinId || pinId.length > 200 || typeof pin !== 'string' || !/^\d{6}$/.test(pin)) return reply({ error: 'Provide a valid verification session and six-digit code' }, 400);
    const limited = await rateLimit(actor.admin!, actor.userId!, 'phone-otp-verify', 10, 600);
    if (limited) return limited;
    // Claim an owner-bound, unexpired attempt before spending a provider call.
    const challenge = await actor.admin!.rpc('claim_phone_verification_attempt', { p_pin_id: pinId, p_user_id: actor.userId });
    if (challenge.error) return reply({ error: 'Verification unavailable' }, 503);
    if (!challenge.data) return reply({ error: 'Invalid or expired verification session. Request a new code.' }, 400);
    const data = await termii('verify', { pin_id: pinId, pin });
    if (data.verified !== true && data.verified !== 'True') return reply({ error: 'Invalid or expired verification code' }, 400);
    const phone = normalizePhone(data.msisdn);
    if (!phone || phone !== challenge.data) return reply({ error: 'Verification phone does not match the requested number' }, 400);
    const result = await actor.admin!.rpc('complete_phone_verification', { p_pin_id: pinId, p_user_id: actor.userId, p_phone: phone });
    if (result.error?.code === '23505') return reply({ error: 'This phone number is already verified on another account.' }, 409);
    if (result.error) return reply({ error: 'Unable to complete verification' }, 503);
    if (result.data !== true) return reply({ error: 'Verification session expired or was already used' }, 400);
    return reply({ success: true });
  } catch {
    console.error('Phone OTP verification failed');
    return reply({ error: 'Verification unavailable. Please try again later.' }, 503);
  }
});
