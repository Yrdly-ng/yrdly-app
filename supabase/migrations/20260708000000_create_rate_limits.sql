CREATE TABLE IF NOT EXISTS public.rate_limits (
    ip_address text NOT NULL,
    endpoint text NOT NULL,
    request_count integer DEFAULT 1,
    window_start timestamp with time zone DEFAULT now(),
    PRIMARY KEY (ip_address, endpoint)
);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
