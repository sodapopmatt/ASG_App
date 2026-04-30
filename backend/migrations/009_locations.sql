-- Sport-scoped courts/locations.
-- Each sport defines its own named courts; the count replaces the old concurrent_courts integer.

-- locations table may already exist without sport_id — create or alter as needed
CREATE TABLE IF NOT EXISTS locations (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add sport_id if it doesn't exist yet
ALTER TABLE locations
    ADD COLUMN IF NOT EXISTS sport_id UUID REFERENCES sports(id) ON DELETE CASCADE;

-- Add unique constraint if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'locations'::regclass AND conname = 'locations_sport_id_name_key'
    ) THEN
        ALTER TABLE locations ADD CONSTRAINT locations_sport_id_name_key UNIQUE (sport_id, name);
    END IF;
END$$;

CREATE INDEX IF NOT EXISTS locations_sport_id_idx ON locations (sport_id);

ALTER TABLE locations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'locations' AND policyname = 'public read'
    ) THEN
        CREATE POLICY "public read" ON locations FOR SELECT USING (true);
    END IF;
END$$;

-- Drop the now-redundant integer; court count comes from COUNT(locations) per sport.
ALTER TABLE sports DROP COLUMN IF EXISTS concurrent_courts;
