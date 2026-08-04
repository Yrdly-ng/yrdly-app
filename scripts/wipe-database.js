const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://yoiyqxtpmxnrrbqqidcs.supabase.co';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlvaXlxeHRwbXhucnJicXFpZGNzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MDEwNjk5OSwiZXhwIjoyMDc1NjgyOTk5fQ.DOV73_zZefY1VoiaxGhaIET5xAXmWgVouBx6-OWFiN8';

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function wipeDatabase() {
  console.log('🚨 Starting full database & user wiping procedure...\n');

  // List of all public tables to clear
  const tables = [
    'comments',
    'likes',
    'post_reactions',
    'posts',
    'marketplace_items',
    'catalog_items',
    'messages',
    'conversations',
    'event_tickets',
    'events',
    'notifications',
    'transactions',
    'disputes',
    'payouts',
    'businesses',
    'alerts',
    'followers',
    'friends',
    'friend_requests',
    'users'
  ];

  for (const table of tables) {
    try {
      const { error } = await supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
      if (error && !error.message.includes('Could not find')) {
        console.log(`⚠️ Table [${table}]: ${error.message}`);
      } else {
        console.log(`✅ Cleared table: ${table}`);
      }
    } catch (e) {
      console.log(`⚠️ Table [${table}]: ${e.message}`);
    }
  }

  // Delete all users from auth.users
  console.log('\n🧹 Clearing auth.users...');
  let pageIndex = 1;
  let totalDeleted = 0;

  while (true) {
    const { data: page, error } = await supabase.auth.admin.listUsers({ page: pageIndex, perPage: 1000 });
    if (error || !page || !page.users || page.users.length === 0) {
      break;
    }

    for (const user of page.users) {
      await supabase.auth.admin.deleteUser(user.id);
      totalDeleted++;
    }
  }

  console.log(`✅ Deleted ${totalDeleted} auth user(s).`);

  // Final verification
  const { data: remainingUsers } = await supabase.from('users').select('id');
  const { data: remainingAuth } = await supabase.auth.admin.listUsers();

  console.log('\n--- VERIFICATION STATUS ---');
  console.log(`Public users table count: ${remainingUsers ? remainingUsers.length : 0}`);
  console.log(`Auth users count: ${remainingAuth && remainingAuth.users ? remainingAuth.users.length : 0}`);

  if ((!remainingUsers || remainingUsers.length === 0) && (!remainingAuth || remainingAuth.users.length === 0)) {
    console.log('🎉 SUCCESS: Clean slate database achieved! All users and relations deleted.\n');
  } else {
    console.log('⚠️ Notice: Some records remain. Run script again if needed.\n');
  }
}

wipeDatabase();
