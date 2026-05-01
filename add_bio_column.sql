-- Run this script in the Supabase SQL Editor to add the bio column to the profiles table.
-- This allows users to save their custom phrase in their profile.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bio TEXT;
