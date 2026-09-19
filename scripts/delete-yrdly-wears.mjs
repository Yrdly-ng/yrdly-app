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

async function run() {
  console.log('--- Searching for business "Yrdly Wears" ---');

  // 1. Check in 'businesses' table
  const { data: businesses, error: bizError } = await supabase
    .from('businesses')
    .select('*')
    .ilike('name', '%yrdly%wears%');

  if (bizError) {
    console.error('Error searching businesses table:', bizError.message);
  } else {
    console.log(`Found ${businesses?.length || 0} business(es) matching "Yrdly Wears" in 'businesses' table:`, businesses);
    if (businesses && businesses.length > 0) {
      for (const biz of businesses) {
        // Delete catalog items first if any
        const { error: catErr } = await supabase
          .from('catalog_items')
          .delete()
          .eq('business_id', biz.id);
        if (catErr) console.warn(`Error deleting catalog items for business ${biz.id}:`, catErr.message);

        // Delete business messages / reviews if any
        await supabase.from('business_messages').delete().eq('business_id', biz.id);
        await supabase.from('business_reviews').delete().eq('business_id', biz.id);

        // Delete business
        const { error: delErr } = await supabase
          .from('businesses')
          .delete()
          .eq('id', biz.id);

        if (delErr) {
          console.error(`Failed to delete business ${biz.name} (${biz.id}):`, delErr.message);
        } else {
          console.log(`✅ Deleted business "${biz.name}" (${biz.id}) from 'businesses' table.`);
        }
      }
    }
  }

  // 2. Also check in 'posts' table (category='Business' or title/text containing Yrdly Wears)
  const { data: posts, error: postError } = await supabase
    .from('posts')
    .select('*')
    .or('title.ilike.%yrdly%wears%,text.ilike.%yrdly%wears%');

  if (postError) {
    console.error('Error searching posts table:', postError.message);
  } else {
    console.log(`Found ${posts?.length || 0} post(s) matching "Yrdly Wears" in 'posts' table:`, posts);
    if (posts && posts.length > 0) {
      for (const post of posts) {
        // Delete post comments / likes if any
        await supabase.from('comments').delete().eq('post_id', post.id);
        const { error: delPostErr } = await supabase
          .from('posts')
          .delete()
          .eq('id', post.id);

        if (delPostErr) {
          console.error(`Failed to delete post ${post.id}:`, delPostErr.message);
        } else {
          console.log(`✅ Deleted post "${post.title || post.text}" (${post.id}) from 'posts' table.`);
        }
      }
    }
  }
}

run();
