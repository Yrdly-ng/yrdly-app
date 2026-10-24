const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const migration = fs.readFileSync('supabase/migrations/20261024161824_isolate_public_profile_data.sql', 'utf8');
const first = '00000000-0000-4000-8000-000000000001';
const second = '00000000-0000-4000-8000-000000000002';
async function fixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.users(id uuid PRIMARY KEY,name text,username text,avatar_url text,bio text,
      interests text[],created_at timestamptz,updated_at timestamptz,home_state text,home_lga text,
      verified_seller boolean,phone_verified boolean,rating numeric,review_count integer,
      discoverable boolean,is_online boolean,last_seen timestamptz,friends uuid[],
      email text,phone text,payluk_customer_id text,is_admin boolean);
    ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
    GRANT SELECT ON public.users TO authenticated;
    CREATE POLICY private_user_read ON public.users FOR SELECT TO authenticated USING (id='${first}');
    CREATE TABLE public.posts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid
      CONSTRAINT posts_user_id_fkey REFERENCES public.users(id) ON DELETE CASCADE);
    CREATE TABLE public.staff(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid
      CONSTRAINT staff_user_id_fkey REFERENCES public.users(id) ON DELETE SET NULL);
    CREATE VIEW public.public_profiles AS SELECT id,name,username,avatar_url,bio,interests,created_at,updated_at,
      home_state,home_lga,verified_seller,phone_verified,rating,review_count,discoverable,is_online,last_seen,
      jsonb_build_object('state',home_state,'lga',home_lga) AS location,coalesce(cardinality(friends),0) AS friend_count FROM public.users;
    GRANT SELECT ON public.public_profiles TO anon,authenticated;
    INSERT INTO public.users(id,name,email,phone,payluk_customer_id,is_admin,friends) VALUES
      ('${first}','Public One','private-one@example.test','private-phone','private-provider',true,ARRAY['${second}'::uuid]),
      ('${second}','Public Two','private-two@example.test',null,null,false,null);
    INSERT INTO public.posts(user_id) VALUES('${second}');
    INSERT INTO public.staff(user_id) VALUES('${second}');
    CREATE FUNCTION public.auto_post() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      INSERT INTO public.posts(user_id) VALUES(NEW.id); RETURN NEW; END $$;
    CREATE TRIGGER a_auto_post AFTER INSERT ON public.users FOR EACH ROW EXECUTE FUNCTION public.auto_post();
  `);
  return db;
}
test('public profiles use caller permissions, expose only safe fields, and preserve private user RLS', async () => {
  const db=await fixture();
  try {
    await db.exec(migration);
    const options=(await db.query("SELECT reloptions FROM pg_class WHERE oid='public.public_profiles'::regclass")).rows[0].reloptions;
    assert.ok(options.includes('security_invoker=true'));
    for(const role of ['anon','authenticated']) {
      await db.exec(`SET ROLE ${role}`);
      const profiles=(await db.query('SELECT * FROM public.public_profiles ORDER BY id')).rows;
      assert.equal(profiles.length,2);
      for(const row of profiles) for(const field of ['email','phone','payluk_customer_id','is_admin','friends']) assert.equal(field in row,false);
      assert.equal(profiles[0].friend_count,1);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM public.public_profile_data')).rows[0].n,2);
      await assert.rejects(db.exec("UPDATE public.public_profile_data SET name='Forged'"),/permission denied/);
      await assert.rejects(db.exec('DELETE FROM public.public_profiles'),/permission denied/);
      await assert.rejects(db.exec('SELECT private.sync_public_profile_data()'),/permission denied/);
      if(role==='anon') await assert.rejects(db.exec('SELECT email FROM public.users'),/permission denied/);
      else assert.equal((await db.query('SELECT email FROM public.users')).rows.length,1);
      await db.exec('RESET ROLE');
    }
  } finally {await db.close();}
});
test('mirror tracks updates and signup-trigger writes; original cascade and set-null semantics survive',async()=>{
  const db=await fixture();
  try {
    await db.exec(migration);
    await db.exec(`UPDATE public.users SET name='Updated',friends='{}' WHERE id='${first}'`);
    assert.deepEqual((await db.query(`SELECT name,friend_count FROM public.public_profiles WHERE id='${first}'`)).rows,[{name:'Updated',friend_count:0}]);
    await db.exec("INSERT INTO public.users(id,name) VALUES('00000000-0000-4000-8000-000000000003','New')");
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.public_profile_data')).rows[0].n,3);
    await db.exec(`DELETE FROM public.users WHERE id='${second}'`);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.posts WHERE user_id='${second}'`)).rows[0].n,0);
    assert.equal((await db.query('SELECT user_id FROM public.staff')).rows[0].user_id,null);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.public_profiles WHERE id='${second}'`)).rows[0].n,0);
    const targets=(await db.query("SELECT conname,confrelid::regclass::text AS target,condeferrable,condeferred FROM pg_constraint WHERE conname='posts_user_id_fkey'")).rows;
    assert.deepEqual(targets,[{conname:'posts_user_id_fkey',target:'public_profile_data',condeferrable:true,condeferred:true}]);
  } finally {await db.close();}
});
