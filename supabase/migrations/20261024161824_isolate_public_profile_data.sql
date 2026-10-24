-- Public profile reads must never execute with the private users owner's permissions.
BEGIN;
SET LOCAL lock_timeout = '10s';
LOCK TABLE public.users IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE public.public_profile_data AS
SELECT id,name,username,avatar_url,bio,interests,created_at,updated_at,
       home_state,home_lga,verified_seller,phone_verified,rating,review_count,
       discoverable,is_online,last_seen,
       jsonb_build_object('state',home_state,'lga',home_lga) AS location,
       coalesce(cardinality(friends),0) AS friend_count
FROM public.users;
ALTER TABLE public.public_profile_data ADD PRIMARY KEY (id);
ALTER TABLE public.public_profile_data ADD CONSTRAINT public_profile_data_user_fkey
  FOREIGN KEY (id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE public.public_profile_data ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.public_profile_data FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.public_profile_data TO anon,authenticated,service_role;
CREATE POLICY public_profile_data_read ON public.public_profile_data
  FOR SELECT TO anon,authenticated USING (true);

CREATE SCHEMA IF NOT EXISTS private;
CREATE FUNCTION private.sync_public_profile_data() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.public_profile_data
    (id,name,username,avatar_url,bio,interests,created_at,updated_at,
     home_state,home_lga,verified_seller,phone_verified,rating,review_count,
     discoverable,is_online,last_seen,location,friend_count)
  VALUES
    (NEW.id,NEW.name,NEW.username,NEW.avatar_url,NEW.bio,NEW.interests,NEW.created_at,NEW.updated_at,
     NEW.home_state,NEW.home_lga,NEW.verified_seller,NEW.phone_verified,NEW.rating,NEW.review_count,
     NEW.discoverable,NEW.is_online,NEW.last_seen,
     jsonb_build_object('state',NEW.home_state,'lga',NEW.home_lga),coalesce(cardinality(NEW.friends),0))
  ON CONFLICT (id) DO UPDATE SET
    name=excluded.name,username=excluded.username,avatar_url=excluded.avatar_url,
    bio=excluded.bio,interests=excluded.interests,created_at=excluded.created_at,updated_at=excluded.updated_at,
    home_state=excluded.home_state,home_lga=excluded.home_lga,verified_seller=excluded.verified_seller,
    phone_verified=excluded.phone_verified,rating=excluded.rating,review_count=excluded.review_count,
    discoverable=excluded.discoverable,is_online=excluded.is_online,last_seen=excluded.last_seen,
    location=excluded.location,friend_count=excluded.friend_count;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.sync_public_profile_data() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER "000_sync_public_profile_data" AFTER INSERT OR UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION private.sync_public_profile_data();

-- Preserve users' original ownership/deletion semantics. Public-profile
-- relationships receive the old constraint names so deployed !*_fkey embeds
-- keep resolving without an app update. New checks are deferred because user
-- signup triggers can insert related records before the profile mirror runs.
DO $$
DECLARE fk record; source_column text; private_name text;
BEGIN
  FOR fk IN
    SELECT c.oid,c.conname,c.conrelid,c.conkey,c.confkey
    FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid
    JOIN pg_namespace n ON n.oid=r.relnamespace
    WHERE c.contype='f' AND c.confrelid='public.users'::regclass
      AND n.nspname='public' AND c.conrelid<>'public.public_profile_data'::regclass
    ORDER BY c.conrelid,c.conname
  LOOP
    IF cardinality(fk.conkey)<>1 OR cardinality(fk.confkey)<>1 OR
      (SELECT attname FROM pg_attribute WHERE attrelid='public.users'::regclass AND attnum=fk.confkey[1])<>'id'
    THEN RAISE EXCEPTION 'Unsupported user foreign key: %',fk.conname; END IF;
    SELECT attname INTO source_column FROM pg_attribute WHERE attrelid=fk.conrelid AND attnum=fk.conkey[1];
    private_name := left(fk.conname,39)||'_private_'||substr(md5(fk.conname),1,12);
    EXECUTE format('ALTER TABLE %s RENAME CONSTRAINT %I TO %I',fk.conrelid::regclass,fk.conname,private_name);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.public_profile_data(id) DEFERRABLE INITIALLY DEFERRED',
      fk.conrelid::regclass,fk.conname,source_column);
  END LOOP;
END $$;

CREATE OR REPLACE VIEW public.public_profiles WITH (security_invoker=true) AS
SELECT id,name,username,avatar_url,bio,interests,created_at,updated_at,
       home_state,home_lga,verified_seller,phone_verified,rating,review_count,
       discoverable,is_online,last_seen,location,friend_count
FROM public.public_profile_data;
REVOKE ALL ON public.public_profiles FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.public_profiles TO anon,authenticated,service_role;
COMMENT ON TABLE public.public_profile_data IS 'Public profile fields only; synchronized transactionally from private users. Clients have read access only.';
NOTIFY pgrst,'reload schema';
COMMIT;
