const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('child-safety migrations enforce suspended sessions and audit reported-post hides', async () => {
  const db = new PGlite();
  const admin = uuid(1);
  const activeUser = uuid(2);
  const suspendedUser = uuid(3);
  const activeSession = uuid(4);
  const suspendedSession = uuid(5);
  const reportId = uuid(6);
  const postId = uuid(7);
  const onboardingUser = uuid(8);
  const onboardingSession = uuid(9);

  try {
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role;
      CREATE SCHEMA auth;
      CREATE SCHEMA private;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
        SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
      $$;
      CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
        SELECT current_setting('request.jwt.claim.role', true)
      $$;
      CREATE TABLE auth.sessions(id uuid, user_id uuid, not_after timestamptz);
      CREATE TABLE private.active_account_sessions(user_id uuid, session_id uuid);
      CREATE TABLE public.users(
        id uuid PRIMARY KEY, is_admin boolean DEFAULT false, role text,
        is_suspended boolean NOT NULL DEFAULT false, is_banned boolean NOT NULL DEFAULT false,
        status text NOT NULL DEFAULT 'active', suspension_reason text, suspended_at timestamptz
      );
      CREATE TABLE public.posts(id uuid PRIMARY KEY, moderation_status text NOT NULL);
      CREATE TABLE public.reports(
        id uuid PRIMARY KEY, reported_user_id uuid, reported_post_id uuid,
        category text, status text
      );
      INSERT INTO public.users(id,is_admin) VALUES ('${admin}',true),('${activeUser}',false);
      INSERT INTO public.users(id,is_suspended,status) VALUES ('${suspendedUser}',true,'suspended');
      INSERT INTO auth.sessions VALUES ('${activeSession}','${activeUser}',null),('${suspendedSession}','${suspendedUser}',null);
      INSERT INTO private.active_account_sessions VALUES ('${activeUser}','${activeSession}'),('${suspendedUser}','${suspendedSession}');
      INSERT INTO auth.sessions VALUES ('${onboardingSession}','${onboardingUser}',null);
      INSERT INTO private.active_account_sessions VALUES ('${onboardingUser}','${onboardingSession}');
      INSERT INTO public.posts VALUES ('${postId}','approved');
      INSERT INTO public.reports VALUES ('${reportId}','${suspendedUser}','${postId}','Child safety','open');
    `);

    for (const name of [
      '20261026170603_enforce_account_suspension_in_active_sessions.sql',
      '20261026170833_add_audited_account_moderation_actions.sql',
      '20261026180520_enable_reported_child_safety_post_takedowns.sql',
    ]) {
      await db.exec(fs.readFileSync(`supabase/migrations/${name}`, 'utf8'));
    }

    await db.query("SELECT set_config('request.jwt.claim.role','authenticated',false)");
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [activeUser]);
    await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ session_id: activeSession })]);
    assert.equal((await db.query('SELECT public.is_current_session_active() AS active')).rows[0].active, true);
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [suspendedUser]);
    await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ session_id: suspendedSession })]);
    assert.equal((await db.query('SELECT public.is_current_session_active() AS active')).rows[0].active, false);
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [onboardingUser]);
    await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ session_id: onboardingSession })]);
    assert.equal((await db.query('SELECT public.is_current_session_active() AS active')).rows[0].active, true);

    await db.query("SELECT set_config('request.jwt.claim.role','service_role',false)");
    const suspension = await db.query(
      'SELECT public.admin_set_account_moderation($1,$2,$3,$4,$5) AS id',
      [admin, activeUser, 'suspend', 'Child safety case', null]
    );
    assert.ok(suspension.rows[0].id);
    assert.equal((await db.query('SELECT is_suspended FROM public.users WHERE id=$1', [activeUser])).rows[0].is_suspended, true);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.account_moderation_actions')).rows[0].n, 1);

    await db.query('UPDATE public.reports SET category = NULL WHERE id=$1', [reportId]);
    await assert.rejects(
      db.query('SELECT public.admin_hide_child_safety_reported_post($1,$2)', [admin, reportId]),
      { code: '22023' }
    );
    assert.equal((await db.query('SELECT moderation_status FROM public.posts WHERE id=$1', [postId])).rows[0].moderation_status, 'approved');
    await db.query("UPDATE public.reports SET category = 'Child safety', status = NULL WHERE id=$1", [reportId]);
    await assert.rejects(
      db.query('SELECT public.admin_hide_child_safety_reported_post($1,$2)', [admin, reportId]),
      { code: '22023' }
    );
    await db.query("UPDATE public.reports SET status = 'open' WHERE id=$1", [reportId]);

    const hidden = await db.query('SELECT public.admin_hide_child_safety_reported_post($1,$2) AS id', [admin, reportId]);
    assert.ok(hidden.rows[0].id);
    assert.equal((await db.query('SELECT moderation_status FROM public.posts WHERE id=$1', [postId])).rows[0].moderation_status, 'rejected');
    assert.equal((await db.query('SELECT status FROM public.reports WHERE id=$1', [reportId])).rows[0].status, 'open');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.content_moderation_actions')).rows[0].n, 1);
  } finally {
    await db.close();
  }
});
