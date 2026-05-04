ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS home_slot_state TEXT NOT NULL DEFAULT 'tbd'
    CHECK (home_slot_state IN ('tbd', 'bye')),
  ADD COLUMN IF NOT EXISTS away_slot_state TEXT NOT NULL DEFAULT 'tbd'
    CHECK (away_slot_state IN ('tbd', 'bye'));
