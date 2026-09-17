-- Migration: Add user_id to rate_limits, drop ip_address PK, and enforce (user_id, endpoint) uniqueness
ALTER TABLE public.rate_limits
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.rate_limits DROP CONSTRAINT IF EXISTS rate_limits_pkey;

ALTER TABLE public.rate_limits ALTER COLUMN ip_address DROP NOT NULL;

ALTER TABLE public.rate_limits
  ADD CONSTRAINT rate_limits_user_endpoint_key UNIQUE (user_id, endpoint);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rate_limits_ip_endpoint
  ON public.rate_limits (ip_address, endpoint)
  WHERE ip_address IS NOT NULL AND user_id IS NULL;
