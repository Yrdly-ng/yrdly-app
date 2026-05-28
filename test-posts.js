import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function checkPosts() {
  const { data } = await supabase.from('posts').select('id, title, category, state, lga, ward, event_location').eq('category', 'Event');
  console.log(data);
}

checkPosts();
