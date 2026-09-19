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
  console.log('--- Syncing Post Comment Counts ---');

  // Fetch all posts
  const { data: posts, error: postsErr } = await supabase
    .from('posts')
    .select('id, comment_count');

  if (postsErr) {
    console.error('Error fetching posts:', postsErr.message);
    return;
  }

  console.log(`Checking ${posts.length} posts for comment count accuracy...`);

  let updatedCount = 0;
  for (const post of posts) {
    const { count, error: countErr } = await supabase
      .from('comments')
      .select('id', { count: 'exact', head: true })
      .eq('post_id', post.id);

    if (countErr) {
      console.warn(`Error counting comments for post ${post.id}:`, countErr.message);
      continue;
    }

    const actualCount = count || 0;
    if (actualCount !== (post.comment_count || 0)) {
      const { error: updateErr } = await supabase
        .from('posts')
        .update({ comment_count: actualCount })
        .eq('id', post.id);

      if (updateErr) {
        console.error(`Failed to update comment_count for post ${post.id}:`, updateErr.message);
      } else {
        console.log(`✅ Updated post ${post.id}: ${post.comment_count || 0} -> ${actualCount} comments`);
        updatedCount++;
      }
    }
  }

  console.log(`🎉 Sync completed! Updated ${updatedCount} post(s).`);
}

run();
