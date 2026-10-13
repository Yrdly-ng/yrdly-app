// Isolated Postgres regression. No network, credentials, or live databases.
// Install @electric-sql/pglite in a temporary directory; set PGLITE_MODULE to its
// dist/index.js path when it is not installed in this application's dependencies.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const alice = '00000000-0000-0000-0000-000000000001';
const bob = '00000000-0000-0000-0000-000000000002';
const legacy = '00000000-0000-0000-0000-000000000003';
const otherLegacy = '00000000-0000-0000-0000-000000000004';
const checks = [];
const check = async (name, run) => { await run(); checks.push(name); console.log(`PASS ${name}`); };
const insert = (id, name, owner = alice, key = null) => db.query(
  `INSERT INTO public.communities(id,name,created_by,approval_status,submission_key)
   VALUES ($1,$2,$3,'pending',$4)`, [id, name, owner, key]);
const rejected = async (operation, code) => {
  let caught;
  try { await operation(); } catch (error) { caught = error; }
  assert.equal(caught?.code, code);
};
try {
  await db.exec(`
    CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE TABLE public.users(id uuid PRIMARY KEY);
    CREATE TABLE public.communities(
      id uuid PRIMARY KEY, name text NOT NULL, created_by uuid REFERENCES public.users(id),
      approval_status text NOT NULL, created_at timestamptz DEFAULT now()
    );
    INSERT INTO public.users VALUES ('${alice}'), ('${bob}');
    INSERT INTO public.communities(id,name,created_by,approval_status) VALUES
      ('${legacy}', 'Legacy Club', '${alice}', 'pending'),
      ('${otherLegacy}', ' LEGACY   club ', '${alice}', 'pending');
    ALTER TABLE public.communities ENABLE ROW LEVEL SECURITY;
    GRANT SELECT, INSERT ON public.communities TO authenticated;
    CREATE POLICY own_submissions ON public.communities FOR SELECT TO authenticated USING (created_by = auth.uid());
    CREATE POLICY create_submission ON public.communities FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());
  `);
  await db.exec(await readFile(new URL('../supabase/migrations/20261012130109_community_submission_dismissal_and_duplicates.sql', import.meta.url), 'utf8'));
  await check('migration preserves existing pending duplicate submissions', async () => {
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.communities')).rows[0].n, 2);
  });
  await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${alice}', false);`);
  const id = '00000000-0000-0000-0000-000000000005';
  await insert(id, 'Garden Club');
  await check('normalized duplicate requests and caller-supplied keys are rejected', async () => {
    await rejected(() => insert('00000000-0000-0000-0000-000000000006', '  GARDEN   club  ', alice, 'bypass'), '23505');
  });
  await check('dismissal keeps the real request pending and survives rereading', async () => {
    await db.query('INSERT INTO public.community_submission_dismissals(user_id,community_id) VALUES ($1,$2)', [alice, id]);
    assert.equal((await db.query('SELECT approval_status FROM public.communities WHERE id=$1', [id])).rows[0].approval_status, 'pending');
    assert.equal((await db.query('SELECT community_id FROM public.community_submission_dismissals')).rows[0].community_id, id);
    await rejected(() => insert('00000000-0000-0000-0000-000000000007', 'Garden Club'), '23505');
  });
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${bob}', false);`);
  await check('another user cannot read or dismiss the creator request', async () => {
    assert.equal((await db.query('SELECT * FROM public.community_submission_dismissals')).rows.length, 0);
    await rejected(() => db.query('INSERT INTO public.community_submission_dismissals(user_id,community_id) VALUES ($1,$2)', [bob, id]), '42501');
    await rejected(() => db.query('INSERT INTO public.community_submission_dismissals(user_id,community_id) VALUES ($1,$2)', [alice, legacy]), '42501');
  });
  await check('different creators may submit communities with the same name', async () => {
    await insert('00000000-0000-0000-0000-000000000008', 'Garden Club', bob);
  });
  await db.exec(`RESET ROLE; UPDATE public.communities SET approval_status='rejected' WHERE id='${id}';
    UPDATE public.communities SET approval_status='rejected' WHERE id='${legacy}';
    SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${alice}', false);`);
  await check('rejected requests can be retried', async () => {
    await insert('00000000-0000-0000-0000-000000000009', 'Garden Club');
  });
  await check('legacy keyless pending duplicates still block new submissions', async () => {
    await rejected(() => insert('00000000-0000-0000-0000-000000000010', 'Legacy Club'), '23505');
  });
  console.log(`${checks.length}/${checks.length} isolated Postgres checks passed`);
} finally { await db.close(); }
