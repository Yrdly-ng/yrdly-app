-- Add optional reviewed_at column to safety_alerts table
ALTER TABLE public.safety_alerts ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP WITH TIME ZONE;
