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
    const phone = normalizePhone(input.phone);
    if (!phone) return reply({ error: 'Invalid Nigerian phone number' }, 400);
    const limited = await rateLimit(actor.admin!, actor.userId!, 'phone-otp-send', 3, 900);
    if (limited) return limited;
    // The completion RPC also checks all normalized phone variants atomically.
    const existing = await actor.admin!.from('users').select('id').in('phone', [phone, '+' + phone, '0' + phone.slice(3)]).eq('phone_verified', true).neq('id', actor.userId!).limit(1);
    if (existing.error) return reply({ error: 'Verification unavailable' }, 503);
    if (existing.data?.length) return reply({ error: 'This phone number is already verified on another account.' }, 409);
    const data = await termii('send', {
      pin_type: 'NUMERIC', to: phone, from: Deno.env.get('TERMII_SENDER_ID') || 'OE Alert', channel: 'dnd',
      pin_attempts: 3, pin_time_to_live: 10, pin_length: 6, pin_placeholder: '< 1234 >',
      message_text: 'Your Yrdly verification code is < 1234 >. Expires in 10 mins.',
    });
    if (data.smsStatus !== 'Message Sent' || typeof data.pinId !== 'string' || data.pinId.length > 200) return reply({ error: 'Unable to send verification code' }, 502);
    const saved = await actor.admin!.from('phone_verification_challenges').insert({ pin_id: data.pinId, user_id: actor.userId, phone });
    if (saved.error) return reply({ error: 'Unable to save verification session. Please request a new code.' }, 503);
    return reply({ pinId: data.pinId });
  } catch {
    console.error('Phone OTP send failed');
    return reply({ error: 'Verification unavailable. Please try again later.' }, 503);
  }
});
