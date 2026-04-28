-- ROSARIO CONTINUO TABLE
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS continuo_slots (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    date_key TEXT NOT NULL,          -- '2026-04-28'
    hour INTEGER NOT NULL CHECK (hour >= 0 AND hour < 24),
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    user_name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(date_key, hour, user_id)
);

ALTER TABLE continuo_slots ENABLE ROW LEVEL SECURITY;

-- Everyone can see who's signed up
CREATE POLICY "read_continuo" ON continuo_slots FOR SELECT USING (true);

-- Authenticated users can sign up
CREATE POLICY "insert_continuo" ON continuo_slots FOR INSERT WITH CHECK (true);

-- Users can cancel their own slots
CREATE POLICY "delete_continuo" ON continuo_slots FOR DELETE USING (true);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE continuo_slots;
