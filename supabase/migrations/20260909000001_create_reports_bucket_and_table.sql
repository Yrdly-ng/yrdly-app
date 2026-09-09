-- 1. Create reports storage bucket
INSERT INTO storage.buckets (id, name, public) 
VALUES ('reports', 'reports', true) 
ON CONFLICT (id) DO NOTHING;

-- Storage policies for reports bucket
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Authenticated users can upload report images'
    ) THEN
        CREATE POLICY "Authenticated users can upload report images" 
        ON storage.objects FOR INSERT 
        TO authenticated 
        WITH CHECK (bucket_id = 'reports');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Public read report images'
    ) THEN
        CREATE POLICY "Public read report images" 
        ON storage.objects FOR SELECT 
        TO public 
        USING (bucket_id = 'reports');
    END IF;
END $$;

-- 2. Update reports table schema to support general issue reports
ALTER TABLE public.reports 
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS subject text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS image_url text;

ALTER TABLE public.reports ALTER COLUMN reporter_id DROP NOT NULL;
ALTER TABLE public.reports ALTER COLUMN reason DROP NOT NULL;

-- Enable RLS and policies
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'reports' AND policyname = 'Users can create reports'
    ) THEN
        CREATE POLICY "Users can create reports" 
        ON public.reports FOR INSERT 
        TO authenticated 
        WITH CHECK (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'reports' AND policyname = 'Users can view their own reports'
    ) THEN
        CREATE POLICY "Users can view their own reports" 
        ON public.reports FOR SELECT 
        TO authenticated 
        USING (user_id = auth.uid() OR reporter_id = auth.uid());
    END IF;
END $$;
