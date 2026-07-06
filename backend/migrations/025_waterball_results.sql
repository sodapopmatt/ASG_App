-- Water Ball Toss: real matches like every other sport, just scored
-- differently. bracket_type = 'heats' so it gets real per-team matches
-- (started via the normal Start button, entered via the existing generic
-- POST /matches/{id}/heat-result — the same mechanism Human Pyramid/Relay
-- Race use for their time, just holding "rounds survived" instead of
-- milliseconds) grouped into two heat brackets ("Group A"/"Group B", built
-- from teams.pool_index via the existing PUT /sports/{id}/pool-setup).
--
-- scoring_mode = 'water_ball_toss' keeps its scoring bespoke: a team that
-- shows up but drops on the first toss survived 0 rounds -> 1pt; points =
-- rounds_survived + 1, or 0 if forfeited. A company's score is the best of
-- its own teams' points (refs only track whichever team goes furthest) —
-- computed by POST /waterball-results/sports/{id}/recompute. This is NOT
-- called automatically when a result is entered — standings are deliberately
-- not live; an admin reviews the computed placements on the Scoring page and
-- explicitly saves, which is what triggers this recompute.

ALTER TABLE sports DROP CONSTRAINT IF EXISTS sports_scoring_mode_check;
ALTER TABLE sports
    ADD CONSTRAINT sports_scoring_mode_check
        CHECK (scoring_mode IN ('placement', 'donation_count', 'water_ball_toss'));

COMMENT ON COLUMN sports.scoring_mode IS
    'placement: admin awards placements via /event-points/award-placement (default). '
    'donation_count: admin enters per-company item counts via /donation-counts; points derived from buckets (top=15, second=10, >=10 items=5, else=0). '
    'water_ball_toss: real per-team matches (bracket_type=heats); rounds survived entered via the generic heat-result endpoint; company score = best of its teams, ranked and awarded the sport''s placement scale (ties share points) via POST /waterball-results/sports/{id}/recompute.';

UPDATE sports SET scoring_mode = 'water_ball_toss', bracket_type = 'heats' WHERE name = 'Water Ball Toss';
