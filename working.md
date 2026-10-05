# Phase 0 Recon Report & Phase 1 Migration Plan — NIN Verification (Revised)

> [!IMPORTANT]
> **RECON ONLY / READ-ONLY**: No database migrations or file writes to code/functions have been executed on Supabase. This document presents the literal unedited database output, explanation of RLS policies, Phase 0 corrections, and the exact revised SQL proposed for Phase 1.

---

## A. Database Inspection & RLS Discrepancy

### 1. Literal Unedited `information_schema.columns` Output for `public.users`
```
column_name             | data_type                | is_nullable
------------------------+--------------------------+------------
id                      | uuid                     | NO
name                    | text                     | NO
email                   | text                     | YES
username                | text                     | YES
avatar_url              | text                     | YES
bio                     | text                     | YES
location                | jsonb                    | YES
friends                 | ARRAY                    | YES
blocked_users           | ARRAY                    | YES
notification_settings   | jsonb                    | YES
is_online               | boolean                  | YES
last_seen               | timestamp with time zone | YES
onboarding_status       | USER-DEFINED             | YES
profile_completed       | boolean                  | YES
onboarding_completed_at | timestamp with time zone | YES
tour_completed          | boolean                  | YES
welcome_message_sent    | boolean                  | YES
created_at              | timestamp with time zone | YES
updated_at              | timestamp with time zone | YES
interests               | ARRAY                    | YES
share_location          | boolean                  | YES
current_location        | jsonb                    | YES
location_updated_at     | timestamp with time zone | YES
is_admin                | boolean                  | NO
email_reminders_enabled | boolean                  | NO
digest_reminder_sent_at | timestamp with time zone | YES
role                    | text                     | NO
discoverable            | boolean                  | NO
legal_name              | text                     | YES
review_count            | integer                  | YES
rating                  | numeric                  | YES
verified_seller         | boolean                  | YES
phone                   | text                     | YES
phone_verified          | boolean                  | NO
phone_verified_at       | timestamp with time zone | YES
delete_requested_at     | timestamp with time zone | YES
delete_requested        | boolean                  | YES
home_state              | text                     | YES
home_lga                | text                     | YES
home_ward               | text                     | YES
home_lat                | double precision         | YES
home_lng                | double precision         | YES
payluk_customer_id      | text                     | YES
home_location_geom      | USER-DEFINED             | YES
no_show_count           | integer                  | NO
late_cancellation_count | integer                  | NO
is_flagged              | boolean                  | NO
```

### 2. Literal Unedited `pg_policies` Output for `public.users`
```
cmd    | policyname                                   | qual                                                  | roles    | with_check
-------+----------------------------------------------+-------------------------------------------------------+----------+-----------------------------------------------------
ALL    | Allow all operations for authenticated users | (auth.role() = 'authenticated'::text)                 | {public} | null
SELECT | Users can view discoverable profiles         | ((discoverable = true) OR (id = auth.uid()))          | {public} | null
UPDATE | Users can update own profile                 | (id = auth.uid())                                     | {public} | (id = auth.uid())
INSERT | Users can insert own profile                 | null                                                  | {public} | (id = auth.uid())
SELECT | Service role bypasses RLS                    | ((auth.jwt() ->> 'role'::text) = 'service_role'::text)| {public} | null
ALL    | Service role full access                     | ((auth.jwt() ->> 'role'::text) = 'service_role'::text)| {public} | ((auth.jwt() ->> 'role'::text) = 'service_role'::text)
```

### 3. Literal Unedited `relrowsecurity` & `reloptions` Output
```
relname  | relkind | relrowsecurity | reloptions
---------+---------+----------------+------------
users    | r       | true           | null
profiles | v       | false          | null
```

### Discrepancy Explanation
The discrepancy in the previous report stemmed from manual synthesis of policy names rather than pasting the exact raw CLI table output verbatim from `pg_policies`. The unedited query output above reflects the true database state.

---

## C. Phase 0 Corrections

1. **Prembly**: Endpoint details for vNIN vs plain NIN are marked **UNVERIFIED**. Prembly will not be implemented; we implement **Dojah only**.
2. **Dojah**: Response JSON shapes for vNIN and NIN endpoints are marked **UNVERIFIED**. Exact keys (`firstname`, `surname`) will be confirmed via a live sandbox call post-migration using NIN test value `70123456789`.
3. **Name Matcher**: Name matcher will NOT iterate over arbitrary JSON string fields. It will strictly read `firstname` and `surname` fields, ignoring `middlename`, treating `"UNVERIFIED"`, `null`, and empty strings as absent.

---

## B. Phase 1 Revised Migration SQL (Awaiting Approval)

```sql
-- =============================================================================
-- PHASE 1: REVISED NIN VERIFICATION MIGRATION
-- =============================================================================

-- 1. Add nin_verified and nin_verified_at to public.users
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS nin_verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS nin_verified_at TIMESTAMPTZ;

-- 2. Create public.nin_verifications for provider audit details (service role only)
CREATE TABLE IF NOT EXISTS public.nin_verifications (
    user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    provider_ref TEXT,
    match_status TEXT NOT NULL CHECK (match_status IN ('pass', 'review', 'fail')),
    verified_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.nin_verifications ENABLE ROW LEVEL SECURITY;
-- (No client policies added; service_role access only)

-- 3. Create public.nin_verification_attempts for 24h rate limiting (service role only)
CREATE TABLE IF NOT EXISTS public.nin_verification_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    outcome TEXT NOT NULL CHECK (outcome IN ('pass', 'review', 'fail', 'error', 'rate_limited')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nin_attempts_user_created 
  ON public.nin_verification_attempts(user_id, created_at DESC);

ALTER TABLE public.nin_verification_attempts ENABLE ROW LEVEL SECURITY;
-- (No client policies added; service_role access only)

-- 4. Update public.profiles view (preserves reloptions=null and relrowsecurity=false)
CREATE OR REPLACE VIEW public.profiles AS
SELECT
    id,
    updated_at,
    username,
    name AS full_name,
    avatar_url,
    website,
    phone AS phone_number,
    phone_verified,
    role,
    bio,
    push_token,
    is_suspended,
    suspended_at,
    suspended_by,
    home_ward,
    home_lga,
    home_state,
    location,
    home_lat,
    home_lng,
    verified_seller AS is_seller,
    nin_verified,
    nin_verified_at
FROM public.users;

-- 5. Trigger on public.users BEFORE INSERT OR UPDATE (no SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.handle_user_nin_protection()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Allow service_role to make changes
  IF (auth.jwt() ->> 'role') = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Force verification fields to false/null on client insert
    NEW.nin_verified := false;
    NEW.nin_verified_at := NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Block standard client updates directly attempting to change nin_verified or nin_verified_at
    IF NEW.nin_verified IS DISTINCT FROM OLD.nin_verified OR
       NEW.nin_verified_at IS DISTINCT FROM OLD.nin_verified_at THEN
      RAISE EXCEPTION 'Unauthorized: Clients cannot update NIN verification status';
    END IF;

    -- Reset verification status if name or legal_name changes while verified
    IF OLD.nin_verified IS TRUE AND (
       NEW.name IS DISTINCT FROM OLD.name OR
       NEW.legal_name IS DISTINCT FROM OLD.legal_name
    ) THEN
      NEW.nin_verified := false;
      NEW.nin_verified_at := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_handle_user_nin_protection ON public.users;
CREATE TRIGGER trg_handle_user_nin_protection
BEFORE INSERT OR UPDATE ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_user_nin_protection();

-- 6. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
```
