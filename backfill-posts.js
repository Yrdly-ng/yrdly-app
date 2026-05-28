import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function updatePosts() {
  await supabase.from('posts').update({ state: 'Lagos', lga: 'Eti-Osa', ward: 'Lekki' }).eq('id', 'e51c5288-d407-49a2-a547-7b3511b2d0a8');
  await supabase.from('posts').update({ state: 'Lagos', lga: 'Lagos Island', ward: 'Lagos' }).eq('id', '92052d70-903c-42a2-bf01-b31ef8ce02db');
  await supabase.from('posts').update({ state: 'Lagos', lga: 'Eti-Osa', ward: 'Lekki' }).eq('id', '75fe9efd-02ff-49de-8509-28391c348a1b');
  console.log("Updated posts");
}

updatePosts();
