-- Add is_edited column to posts table to track explicit post edits vs automatic updated_at trigger updates (from comments, likes, etc.)
ALTER TABLE posts ADD COLUMN IF NOT EXISTS is_edited BOOLEAN DEFAULT FALSE;
