CREATE TABLE IF NOT EXISTS iglesias_comunidad (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pais TEXT NOT NULL,
    ciudad TEXT NOT NULL,
    nombre TEXT NOT NULL,
    direccion TEXT NOT NULL,
    horarios TEXT NOT NULL,
    user_email TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE iglesias_comunidad ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read
CREATE POLICY "Public read access for iglesias_comunidad" ON iglesias_comunidad
    FOR SELECT USING (true);

-- Allow authenticated users to insert
CREATE POLICY "Users can insert iglesias_comunidad" ON iglesias_comunidad
    FOR INSERT WITH CHECK (true);
