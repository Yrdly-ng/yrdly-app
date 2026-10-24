// Read-only production smoke: never print rows, credentials, or private values.
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
assert.ok(url && key, 'Missing public Supabase configuration');
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const profiles = await client.from('public_profiles').select('*').limit(1);
assert.equal(profiles.error, null, `Profile API failed: ${profiles.error?.code}`);
assert.ok(profiles.data.length > 0, 'Expected a populated public-profile projection');
const allowed = ['id','name','username','avatar_url','bio','interests','created_at','updated_at',
  'home_state','home_lga','verified_seller','phone_verified','rating','review_count','discoverable',
  'is_online','last_seen','location','friend_count'];
assert.deepEqual(Object.keys(profiles.data[0]).sort(), allowed.sort());
console.log('PASS public profile reads expose exactly the approved fields');

const joins = [
  ['posts','author:public_profiles!posts_user_id_fkey(id,name,avatar_url)'],
  ['events','organizer:public_profiles!events_organizer_id_fkey(id,name,avatar_url)'],
  ['comments','author:public_profiles!comments_user_id_fkey(id,name,avatar_url)'],
  ['bookings','customer:public_profiles!bookings_customer_id_fkey(id,name)'],
  ['business_messages','users:public_profiles!business_messages_sender_id_fkey(name,avatar_url)'],
  ['community_memberships','user:public_profiles!community_memberships_user_id_fkey!inner(id,name,avatar_url)'],
  ['followers','following:public_profiles!followers_following_id_fkey(id,name)'],
  ['followers','follower:public_profiles!followers_follower_id_fkey(id,name)'],
  ['escrow_transactions','buyer:public_profiles!escrow_transactions_buyer_id_fkey(id,name),seller:public_profiles!escrow_transactions_seller_id_fkey(id,name)'],
  ['tickets','buyer:public_profiles!tickets_buyer_id_fkey(id,name)'],
];
for (const [table, select] of joins) {
  const { error } = await client.from(table).select(select).limit(0);
  assert.equal(error, null, `${table} relationship failed: ${error?.code}: ${error?.message}`);
  console.log(`PASS deployed profile relationship: ${table}`);
}
const privateRead = await client.from('users').select('email').limit(1);
assert.ok(privateRead.error || privateRead.data?.length === 0, 'Anonymous users must not read private account rows');
console.log('PASS anonymous private-account reads remain denied');
