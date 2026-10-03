-- =============================================================================
-- Migration: Create comment_reports and post_reports tables with RLS policies
-- =============================================================================

-- 1. Create comment_reports table
CREATE TABLE IF NOT EXISTS public.comment_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id UUID NOT NULL,
  post_id UUID,
  reporter_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_comment_reports_comment_id ON public.comment_reports(comment_id);
CREATE INDEX IF NOT EXISTS idx_comment_reports_reporter_id ON public.comment_reports(reporter_id);

-- RLS for comment_reports
ALTER TABLE public.comment_reports ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'comment_reports' AND policyname = 'Users can create comment reports') THEN
    CREATE POLICY "Users can create comment reports" ON public.comment_reports FOR INSERT TO authenticated WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'comment_reports' AND policyname = 'Users can view comment reports') THEN
    CREATE POLICY "Users can view comment reports" ON public.comment_reports FOR SELECT TO authenticated USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'comment_reports' AND policyname = 'Users can delete comment reports') THEN
    CREATE POLICY "Users can delete comment reports" ON public.comment_reports FOR DELETE TO authenticated USING (true);
  END IF;
END $$;

-- 2. Create post_reports table
CREATE TABLE IF NOT EXISTS public.post_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL,
  reporter_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_post_reports_post_id ON public.post_reports(post_id);
CREATE INDEX IF NOT EXISTS idx_post_reports_reporter_id ON public.post_reports(reporter_id);

-- RLS for post_reports
ALTER TABLE public.post_reports ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'post_reports' AND policyname = 'Users can create post reports') THEN
    CREATE POLICY "Users can create post reports" ON public.post_reports FOR INSERT TO authenticated WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'post_reports' AND policyname = 'Users can view post reports') THEN
    CREATE POLICY "Users can view post reports" ON public.post_reports FOR SELECT TO authenticated USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'post_reports' AND policyname = 'Users can delete post reports') THEN
    CREATE POLICY "Users can delete post reports" ON public.post_reports FOR DELETE TO authenticated USING (true);
  END IF;
END $$;
