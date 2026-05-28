import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function backfill() {
  await supabase.from('events').update({ state: 'Lagos', lga: 'Lagos Island' }).eq('id', 'bc0f4c53-967d-48d6-bffd-8aaea6e963b5');
  await supabase.from('events').update({ state: 'Lagos', lga: 'Lagos Island' }).eq('id', 'f0a5b0bc-a505-40c3-98ad-2abf3853bf0b');
  await supabase.from('events').update({ state: 'Lagos', lga: 'Eti-Osa', ward: 'Lekki' }).eq('id', '00bcfa06-7c17-4f9b-8e5b-0dd7ec5267ae');
  await supabase.from('events').update({ state: 'Lagos' }).eq('id', '60b17133-7d9c-467d-b14a-7c9f41eb7371');
  console.log("Updated events");
}

backfill();
