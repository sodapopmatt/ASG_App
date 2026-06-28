-- Add court_number to locations so the number is a separate, queryable field.
-- Add location_label to sports so admins can name the field type (e.g. "Court", "Field", "Lane").

-- 1. Add court_number as nullable (backfilled below)
ALTER TABLE locations ADD COLUMN IF NOT EXISTS court_number INTEGER;

-- 2. Backfill court_number from existing name strings that end in a digit
UPDATE locations
SET court_number = CAST(substring(name FROM '(\d+)\s*$') AS INTEGER)
WHERE name ~ '\d+\s*$'
  AND court_number IS NULL;

-- 3. Unique index on (sport_id, court_number), nulls excluded (donation sport locations stay null)
CREATE UNIQUE INDEX IF NOT EXISTS locations_sport_court_number_unique
  ON locations (sport_id, court_number)
  WHERE court_number IS NOT NULL;

-- 4. Add location_label to sports
ALTER TABLE sports ADD COLUMN IF NOT EXISTS location_label TEXT NOT NULL DEFAULT 'Court';
