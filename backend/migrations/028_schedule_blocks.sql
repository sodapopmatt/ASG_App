-- Event-wide blackout windows (lunch, group photo, etc.) that the live
-- scheduling engine routes matches around: a match's estimated_start is
-- pushed to a block's end_time whenever it would otherwise start or run
-- into one. See _compute_estimated_starts / _push_past_blocks in
-- app/routers/matches.py.

CREATE TABLE IF NOT EXISTS schedule_blocks (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    label      TEXT NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time   TIMESTAMPTZ NOT NULL,
    CONSTRAINT schedule_blocks_time_order CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS schedule_blocks_start_idx ON schedule_blocks (start_time);

ALTER TABLE schedule_blocks ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'schedule_blocks' AND policyname = 'public read'
    ) THEN
        CREATE POLICY "public read" ON schedule_blocks FOR SELECT USING (true);
    END IF;
END$$;
