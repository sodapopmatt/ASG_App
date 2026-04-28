-- Extend the matches.status CHECK constraint to include 'double_forfeit'.
-- A double forfeit eliminates both teams; no winner is recorded.
-- Idempotent: drop-then-add pattern matches prior migrations.

ALTER TABLE matches
    DROP CONSTRAINT IF EXISTS matches_status_check;

ALTER TABLE matches
    ADD CONSTRAINT matches_status_check
        CHECK (status IN ('scheduled', 'in_progress', 'completed', 'forfeit', 'double_forfeit'));
