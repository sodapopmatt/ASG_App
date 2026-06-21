-- Add scoring_mode to sports and a donation_counts table for donation-style sports
-- (e.g. Canned Food Drive: most/2nd-most items donated → 15/10 pts, ≥10 items → 5).

ALTER TABLE sports
    ADD COLUMN IF NOT EXISTS scoring_mode TEXT NOT NULL DEFAULT 'placement'
        CHECK (scoring_mode IN ('placement', 'donation_count'));

COMMENT ON COLUMN sports.scoring_mode IS
    'placement: admin awards placements via /event-points/award-placement (default). '
    'donation_count: admin enters per-company item counts via /donation-counts; points derived from buckets (top=15, second=10, ≥10 items=5, else=0).';

UPDATE sports SET scoring_mode = 'donation_count'
    WHERE name = 'Canned Food Drive';

CREATE TABLE IF NOT EXISTS donation_counts (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    sport_id   UUID NOT NULL REFERENCES sports(id)    ON DELETE CASCADE,
    item_count INTEGER NOT NULL CHECK (item_count >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, sport_id)
);

CREATE INDEX IF NOT EXISTS donation_counts_sport_idx ON donation_counts (sport_id);

ALTER TABLE donation_counts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'donation_counts' AND policyname = 'public read'
    ) THEN
        CREATE POLICY "public read" ON donation_counts FOR SELECT USING (true);
    END IF;
END$$;
