-- Create Storage bucket for chat images
-- Run in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/spplofkotgvumfkeltsr/sql/new

INSERT INTO storage.buckets (id, name, public) VALUES ('chat-images', 'chat-images', true);

-- Allow anyone to upload to chat-images bucket
CREATE POLICY "Anyone can upload chat images" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'chat-images');
CREATE POLICY "Anyone can view chat images" ON storage.objects FOR SELECT USING (bucket_id = 'chat-images');
