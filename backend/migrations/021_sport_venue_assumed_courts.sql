-- venue: display-only label shown on the schedule when a match has no specific
-- court assigned (e.g. "Cornhole Area", "Soccer Fields").
-- assumed_courts_per_group: how many concurrent boards/courts to assume per pool
-- when no individual court locations are defined. Used by the round-robin
-- scheduler to produce realistic within-pool match timing.
ALTER TABLE sports ADD COLUMN IF NOT EXISTS venue TEXT;
ALTER TABLE sports ADD COLUMN IF NOT EXISTS assumed_courts_per_group INTEGER;
