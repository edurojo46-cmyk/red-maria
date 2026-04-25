-- ============================================
-- FIX COMPLETO: Chat real sin depender de Supabase Auth
-- Run this in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/spplofkotgvumfkeltsr/sql/new
-- ============================================

-- 1. Fix MESSAGES policies
DROP POLICY IF EXISTS "Users can see own messages" ON messages;
DROP POLICY IF EXISTS "Users can send messages" ON messages;
DROP POLICY IF EXISTS "Users can mark as read" ON messages;
DROP POLICY IF EXISTS "Anyone can read messages" ON messages;
DROP POLICY IF EXISTS "Anyone can send messages" ON messages;
DROP POLICY IF EXISTS "Anyone can update messages" ON messages;

CREATE POLICY "Anyone can read messages" ON messages FOR SELECT USING (true);
CREATE POLICY "Anyone can send messages" ON messages FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update messages" ON messages FOR UPDATE USING (true);

-- 2. Fix PROFILES policies
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Anyone can insert profile" ON profiles;
DROP POLICY IF EXISTS "Anyone can update profile" ON profiles;

CREATE POLICY "Anyone can insert profile" ON profiles FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update profile" ON profiles FOR UPDATE USING (true);

-- 3. Remove foreign key from profiles to auth.users (allows standalone profiles)
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;

-- 4. Remove foreign key from messages to profiles (allows flexible IDs)
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_from_id_fkey;
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_to_id_fkey;
