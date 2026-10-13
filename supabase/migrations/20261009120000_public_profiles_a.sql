-- Additive prerequisite: apply before deploying clients that use public_profiles.
-- Base-table lockdown is a separate, post-deployment migration.
CREATE OR REPLACE VIEW public.public_profiles WITH (security_invoker = false) AS
SELECT id, name, username, avatar_url, bio, interests, created_at, updated_at,
       home_state, home_lga, verified_seller, phone_verified, rating, review_count,
       discoverable, is_online, last_seen,
       jsonb_build_object('state', home_state, 'lga', home_lga) AS location,
       COALESCE(cardinality(friends), 0) AS friend_count
FROM public.users;
REVOKE ALL ON public.public_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.public_profiles TO anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
