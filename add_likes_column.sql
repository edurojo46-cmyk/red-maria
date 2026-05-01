-- Run this script in the Supabase SQL Editor to add the likes column to the profiles table.
-- This allows users to receive and store likes on their profile.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS likes INTEGER DEFAULT 0;
