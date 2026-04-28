-- Fix rosary_participants table for cross-device sync

-- Add user_name column if missing
ALTER TABLE rosary_participants ADD COLUMN IF NOT EXISTS user_name text DEFAULT 'Anónimo';

-- Ensure rosary_id is type uuid (should already be)
-- ALTER TABLE rosary_participants ALTER COLUMN rosary_id TYPE uuid USING rosary_id::uuid;

-- Drop existing restrictive policies  
DROP POLICY IF EXISTS "Anyone can read participants" ON rosary_participants;
DROP POLICY IF EXISTS "Users can join rosaries" ON rosary_participants;
DROP POLICY IF EXISTS "Users can leave rosaries" ON rosary_participants;

-- Enable RLS
ALTER TABLE rosary_participants ENABLE ROW LEVEL SECURITY;

-- Allow everyone to read (so coordinator sees all participants)
CREATE POLICY "read_participants" ON rosary_participants FOR SELECT USING (true);

-- Allow authenticated to insert
CREATE POLICY "insert_participants" ON rosary_participants FOR INSERT WITH CHECK (true);

-- Allow authenticated to delete their own
CREATE POLICY "delete_participants" ON rosary_participants FOR DELETE USING (true);

-- Allow update
CREATE POLICY "update_participants" ON rosary_participants FOR UPDATE USING (true);

-- Also fix rosaries table RLS
DROP POLICY IF EXISTS "Anyone can read rosaries" ON rosaries;
DROP POLICY IF EXISTS "read_rosaries" ON rosaries;
CREATE POLICY "read_rosaries" ON rosaries FOR SELECT USING (true);

DROP POLICY IF EXISTS "insert_rosaries" ON rosaries;
CREATE POLICY "insert_rosaries" ON rosaries FOR INSERT WITH CHECK (true);
