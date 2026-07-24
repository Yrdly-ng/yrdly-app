const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function main() {
  const { data, error } = await supabase.from('posts').select('*').eq('id', '2af7b453-43ff-4828-b109-7d4836d52a12').single();
  console.log(JSON.stringify({data, error}, null, 2));
}
main();
