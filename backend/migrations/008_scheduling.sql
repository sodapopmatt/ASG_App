-- Add scheduling config to sports
ALTER TABLE sports
  ADD COLUMN IF NOT EXISTS match_duration_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS concurrent_courts INTEGER,
  ADD COLUMN IF NOT EXISTS schedule_start TIMESTAMPTZ;

-- Record when a match actually started (set by the "In Progress" action)
ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS actual_start TIMESTAMPTZ;
