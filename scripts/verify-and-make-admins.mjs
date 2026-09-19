import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')])
);

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const adminsToSetup = [
  { email: 'vickysalami04@gmail.com', phone: '08160783600', e164: '+2348160783600' },
  { email: 'ijomahopiah@gmail.com', phone: '09059976209', e164: '+2349059976209' }
];

async function run() {
  console.log('--- Verifying & Setting Admin Users ---');

  for (const admin of adminsToSetup) {
    const { data: users, error: findError } = await supabase
      .from('users')
      .select('*')
      .ilike('email', admin.email);

    if (findError) {
      console.error(`Error querying user ${admin.email}:`, findError.message);
      continue;
    }

    if (users && users.length > 0) {
      for (const u of users) {
        const updatePayload = {
          is_admin: true,
          role: 'admin',
          phone: admin.phone,
          phone_verified: true,
          phone_verified_at: new Date().toISOString(),
          verified_seller: true,
          updated_at: new Date().toISOString()
        };

        const { error: updateError } = await supabase
          .from('users')
          .update(updatePayload)
          .eq('id', u.id);

        if (updateError) {
          console.error(`Failed to update ${admin.email} (${u.id}):`, updateError.message);
        } else {
          console.log(`✅ Successfully updated ${admin.email} (${u.id}) -> is_admin=true, role='admin', phone_verified=true, phone=${admin.phone}`);
        }
      }
    }

    try {
      const { data: authUsers } = await supabase.auth.admin.listUsers();
      const authUser = authUsers?.users?.find(u => u.email?.toLowerCase() === admin.email.toLowerCase());
      if (authUser) {
        const { error: authUpdateErr } = await supabase.auth.admin.updateUserById(authUser.id, {
          email_confirm: true,
          phone: admin.e164,
          phone_confirm: true,
          user_metadata: { ...authUser.user_metadata, is_admin: true, role: 'admin', is_verified: true, phone_verified: true }
        });
        if (authUpdateErr) {
          console.warn(`Auth metadata update for ${admin.email}:`, authUpdateErr.message);
        } else {
          console.log(`✅ Confirmed Auth email/phone verification and admin status for ${admin.email}`);
        }
      }
    } catch (aErr) {
      console.warn('Auth admin check note:', aErr.message);
    }
  }
}

run();
