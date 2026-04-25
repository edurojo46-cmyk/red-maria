-- ============================================
-- FIX: Allow messages without Supabase Auth
-- Run this in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/spplofkotgvumfkeltsr/sql/new
-- ============================================

-- Drop restrictive policies on messages
DROP POLICY IF EXISTS "Users can see own messages" ON messages;
DROP POLICY IF EXISTS "Users can send messages" ON messages;
DROP POLICY IF EXISTS "Users can mark as read" ON messages;

-- Create open policies (since auth is handled locally)
CREATE POLICY "Anyone can read messages" ON messages FOR SELECT USING (true);
CREATE POLICY "Anyone can send messages" ON messages FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update messages" ON messages FOR UPDATE USING (true);
