const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://yoiyqxtpmxnrrbqqidcs.supabase.co';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlvaXlxeHRwbXhucnJicXFpZGNzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MDEwNjk5OSwiZXhwIjoyMDc1NjgyOTk5fQ.DOV73_zZefY1VoiaxGhaIET5xAXmWgVouBx6-OWFiN8';

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function createTestUser() {
  const email = 'paystack-tester@yrdly.ng';
  const password = 'TestUser123!';
  const name = 'Paystack Reviewer';
  const username = 'paystack_tester';
  const phone = '+2348012345678';

  console.log(`Setting up verified test user: ${email}...`);

  // 1. Auth creation & email confirmation
  const { data: existingUsers } = await supabase.auth.admin.listUsers();
  let user = existingUsers?.users?.find(u => u.email === email);

  if (user) {
    console.log(`User found (ID: ${user.id}). Updating auth attributes...`);
    const { data: updated, error: updateErr } = await supabase.auth.admin.updateUserById(user.id, {
      password,
      email_confirm: true,
      phone,
      phone_confirm: true,
      user_metadata: { name, username, phone }
    });
    if (updateErr) throw updateErr;
    user = updated.user;
  } else {
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      phone,
      phone_confirm: true,
      user_metadata: { name, username, phone }
    });
    if (createErr) throw createErr;
    user = created.user;
    console.log(`Created new auth user: ${user.id}`);
  }

  // 2. Populate fully verified profile in public.users
  const userPayload = {
    email,
    name,
    legal_name: name,
    username,
    phone,
    phone_verified: true,
    phone_verified_at: new Date().toISOString(),
    profile_completed: true,
    onboarding_status: 'completed',
    tour_completed: true,
    verified_seller: true,
    updated_at: new Date().toISOString()
  };

  const { error: upsertErr } = await supabase
    .from('users')
    .upsert({ id: user.id, ...userPayload });

  if (upsertErr) {
    console.error('Failed to update public.users profile:', upsertErr.message);
  } else {
    console.log('✅ Public profile fully updated & verified.');
  }

  console.log('\n✅ TEST USER READY FOR PAYSTACK REVIEW:');
  console.log(`-----------------------------------`);
  console.log(`Email:          ${email}`);
  console.log(`Password:       ${password}`);
  console.log(`Name:           ${name}`);
  console.log(`Phone:          ${phone}`);
  console.log(`Email Verified: YES (100%)`);
  console.log(`Phone Verified: YES (100%)`);
  console.log(`Seller Status:  VERIFIED`);
  console.log(`-----------------------------------\n`);
}

createTestUser().catch(console.error);
