-- Add 'hearts' column to intenciones table if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'intenciones' AND column_name = 'hearts') THEN
        ALTER TABLE intenciones ADD COLUMN hearts INTEGER DEFAULT 0;
    END IF;
END
$$;

-- Allow public updates to intenciones (specifically for the hearts column)
DROP POLICY IF EXISTS "Public update intenciones" ON intenciones;
CREATE POLICY "Public update intenciones" ON intenciones FOR UPDATE USING (true) WITH CHECK (true);
