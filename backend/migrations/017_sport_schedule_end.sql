-- End time for sport-level events that aren't a sequence of matches
-- (e.g. donation drives). Optional for all sports.

ALTER TABLE sports
    ADD COLUMN IF NOT EXISTS schedule_end TIMESTAMPTZ;

COMMENT ON COLUMN sports.schedule_end IS
    'Optional end time. Used by donation_count sports to show a window (start – end) on the schedule; ignored by match-based sports.';
