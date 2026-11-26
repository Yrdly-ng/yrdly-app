const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const sql=fs.readFileSync('supabase/migrations/20261126150000_enforce_account_ban_visibility.sql','utf8');

test('ban migration closes profile, post, and comment visibility for restricted authors',()=>{
 assert.match(sql,/public_profile_data_read[\s\S]*NOT coalesce\(u\.is_banned,false\)[\s\S]*status,'\) NOT IN \('suspended','banned'\)/);
 assert.match(sql,/CREATE POLICY posts_visible[\s\S]*author\.is_banned[\s\S]*moderation_status='approved'/);
 assert.match(sql,/CREATE POLICY comments_moderation_visibility[\s\S]*author\.is_banned/);
 assert.match(sql,/CREATE POLICY comments_moderation_visibility_anon[\s\S]*author\.is_banned/);
});

test('restriction operation snapshots original visibility, hides owned content, and revokes sessions atomically',()=>{
 assert.match(sql,/account_visibility_snapshots/);
 assert.match(sql,/UPDATE public\.posts SET moderation_status='rejected' WHERE user_id=p_target_user_id/);
 assert.match(sql,/UPDATE public\.comments SET moderation_hidden=true WHERE user_id=p_target_user_id/);
 assert.match(sql,/UPDATE public\.users SET[^;]*discoverable=false WHERE id=p_target_user_id/);
 assert.match(sql,/DELETE FROM private\.active_account_sessions WHERE user_id=p_target_user_id/);
 assert.match(sql,/DELETE FROM auth\.sessions WHERE user_id=p_target_user_id/);
});

test('unsuspension restores snapshotted visibility without discarding moderation audit trail',()=>{
 assert.match(sql,/UPDATE public\.posts p SET moderation_status=s\.post_statuses->>p\.id::text/);
 assert.match(sql,/UPDATE public\.comments c SET moderation_hidden=\(s\.comment_hidden->>c\.id::text\)::boolean/);
 assert.match(sql,/DELETE FROM private\.account_visibility_snapshots WHERE user_id=p_target_user_id/);
 assert.match(sql,/INSERT INTO public\.account_moderation_actions/);
});

test('existing suspended and banned accounts receive immediate visibility and session cleanup',()=>{
 assert.match(sql,/Backfill already restricted accounts/);
 assert.match(sql,/UPDATE public\.posts p SET moderation_status='rejected' FROM public\.users u/);
 assert.match(sql,/UPDATE public\.comments c SET moderation_hidden=true FROM public\.users u/);
 assert.match(sql,/DELETE FROM auth\.sessions s USING public\.users u/);
});
