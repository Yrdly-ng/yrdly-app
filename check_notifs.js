require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  const { data, error } = await supabaseAdmin
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(3);
    
  if (error) console.error(error);
  console.log(JSON.stringify(data, null, 2));
}

check();
