-- Create Storage bucket for chat images
-- Run in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/spplofkotgvumfkeltsr/sql/new

-- Step 1: Create bucket (skip if already exists)
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-images', 'chat-images', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Step 2: Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "Anyone can upload chat images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view chat images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can update chat images" ON storage.objects;

-- Step 3: Create policies for full access
-- Allow anyone to upload (INSERT)
CREATE POLICY "Anyone can upload chat images"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'chat-images');

-- Allow anyone to view/download (SELECT)
CREATE POLICY "Anyone can view chat images"
ON storage.objects FOR SELECT
USING (bucket_id = 'chat-images');

-- Allow anyone to update (needed for Supabase Storage internal operations)
CREATE POLICY "Anyone can update chat images"
ON storage.objects FOR UPDATE
USING (bucket_id = 'chat-images')
WITH CHECK (bucket_id = 'chat-images');
