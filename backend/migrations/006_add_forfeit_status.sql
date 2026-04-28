-- Extend the matches.status CHECK constraint to include 'forfeit'.
-- The app-layer schema already defines this value; the DB constraint was missing it.
-- Idempotent: the new constraint name differs so re-running is safe if applied manually.

ALTER TABLE matches
    DROP CONSTRAINT IF EXISTS matches_status_check;

ALTER TABLE matches
    ADD CONSTRAINT matches_status_check
        CHECK (status IN ('scheduled', 'in_progress', 'completed', 'forfeit'));
