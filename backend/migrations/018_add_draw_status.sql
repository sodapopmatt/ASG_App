-- Extend matches.status CHECK constraint to include 'draw'.
-- A draw means both teams tied; no winner_id is set.
-- scores (home_score / away_score) should be recorded with the result.

ALTER TABLE matches
    DROP CONSTRAINT IF EXISTS matches_status_check;

ALTER TABLE matches
    ADD CONSTRAINT matches_status_check
        CHECK (status IN ('scheduled', 'in_progress', 'completed', 'forfeit', 'double_forfeit', 'draw'));
