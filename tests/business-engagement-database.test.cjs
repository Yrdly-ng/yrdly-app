const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

test('database rejects business likes, comments and comment reactions, retaining normal posts and unlike', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE TABLE public.posts(id uuid PRIMARY KEY,category text,liked_by uuid[] DEFAULT '{}');
      CREATE TABLE public.comments(id uuid PRIMARY KEY,post_id uuid REFERENCES public.posts(id),like_count integer DEFAULT 0);
      CREATE TABLE public.comment_likes(comment_id uuid REFERENCES public.comments(id));
    `);
    await db.exec(fs.readFileSync('supabase/migrations/20261024090000_disallow_event_marketplace_engagement.sql', 'utf8'));
    await db.exec(fs.readFileSync('supabase/migrations/20261028155039_disallow_business_post_engagement.sql', 'utf8'));
    const commercial = '00000000-0000-4000-8000-000000000001';
    const normal = '00000000-0000-4000-8000-000000000002';
    const actor = '00000000-0000-4000-8000-000000000003';
    const comment = '00000000-0000-4000-8000-000000000004';
    await db.query("INSERT INTO public.posts(id,category,liked_by) VALUES($1,'General',ARRAY[$3::uuid]),($2,'General','{}')", [commercial,normal,actor]);
    await db.query('INSERT INTO public.comments(id,post_id) VALUES($1,$2)',[comment,commercial]);
    for (const category of ['Business',' marketplace ','For Sale','Event']) {
      await db.query('UPDATE public.posts SET category=$1,liked_by=ARRAY[$3::uuid] WHERE id=$2',[category,commercial,actor]);
      await db.query("UPDATE public.posts SET liked_by='{}' WHERE id=$1",[commercial]);
      await assert.rejects(db.query('UPDATE public.posts SET liked_by=ARRAY[$2::uuid] WHERE id=$1',[commercial,actor]), e=>e.code==='23514');
      await assert.rejects(db.query('INSERT INTO public.comments(id,post_id) VALUES(gen_random_uuid(),$1)',[commercial]), e=>e.code==='23514');
      await assert.rejects(db.query('INSERT INTO public.comment_likes(comment_id) VALUES($1)',[comment]), e=>e.code==='23514');
      await db.query("UPDATE public.posts SET category='General' WHERE id=$1",[commercial]);
    }
    await db.query('UPDATE public.posts SET liked_by=ARRAY[$2::uuid] WHERE id=$1',[normal,actor]);
    await db.query('INSERT INTO public.comments(id,post_id) VALUES(gen_random_uuid(),$1)',[normal]);
  } finally { await db.close(); }
});
