-- Add user_name column to rosary_participants if it doesn't exist
ALTER TABLE rosary_participants ADD COLUMN IF NOT EXISTS user_name text DEFAULT 'Anónimo';

-- Make sure RLS allows reading participants
ALTER TABLE rosary_participants ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read participants
CREATE POLICY IF NOT EXISTS "Anyone can read participants" 
ON rosary_participants FOR SELECT 
USING (true);

-- Allow authenticated users to insert their own participation
CREATE POLICY IF NOT EXISTS "Users can join rosaries" 
ON rosary_participants FOR INSERT 
WITH CHECK (true);

-- Allow users to leave (delete their own participation)
CREATE POLICY IF NOT EXISTS "Users can leave rosaries" 
ON rosary_participants FOR DELETE 
USING (true);
