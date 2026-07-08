-- Executive Golf: real matches like every other sport, scored bespoke.
-- bracket_type = 'heats' so it gets real per-team matches (one flat match per
-- team, no opponent — same shape as Human Pyramid / Water Ball Toss), grouped
-- into two heat brackets named "Round 1" and "Round 2".
--
-- Flow: every company plays the same 3 holes in Round 1 (staggered tee times
-- come from the existing dynamic estimated_start ripple — all Round-1 matches
-- sit on one location = the starting tee, spaced by match_duration_minutes,
-- set to 3). An admin enters 3 hole scores per company; the app sums them.
-- The 6 lowest totals are picked MANUALLY (the "closest to the hole" tiebreak
-- is done offline) and Round 2 is generated with those 6. Round 2 replays the
-- 3 holes; the 6 companies are ranked by lowest total.
--
-- scoring_mode = 'executive_golf' keeps scoring bespoke: hole scores are stored
-- as a JSON array in matches.notes and the round total in matches.home_score;
-- points come only from Round-2 totals (top 3 = 20/15/10, everyone else who
-- competed = 5, ties share averaged points) via
-- POST /golf-results/sports/{id}/recompute. Like Water Ball Toss this is NOT
-- called automatically — an admin reviews the computed placements on the
-- Scoring page and explicitly saves, which triggers the recompute.

ALTER TABLE sports DROP CONSTRAINT IF EXISTS sports_scoring_mode_check;
ALTER TABLE sports
    ADD CONSTRAINT sports_scoring_mode_check
        CHECK (scoring_mode IN ('placement', 'donation_count', 'water_ball_toss', 'executive_golf'));

COMMENT ON COLUMN sports.scoring_mode IS
    'placement: admin awards placements via /event-points/award-placement (default). '
    'donation_count: admin enters per-company item counts via /donation-counts; points derived from buckets (top=15, second=10, >=10 items=5, else=0). '
    'water_ball_toss: real per-team matches (bracket_type=heats); rounds survived entered via the generic heat-result endpoint; company score = best of its teams, ranked and awarded the sport''s placement scale (ties share points) via POST /waterball-results/sports/{id}/recompute. '
    'executive_golf: real per-team matches (bracket_type=heats) in two "Round 1"/"Round 2" heat brackets; 3 hole scores per company entered via /golf-results (stored as a JSON array in notes, total in home_score); companies ranked by Round-2 total (low), awarded points_scale (ties share points) via POST /golf-results/sports/{id}/recompute.';

UPDATE sports
    SET scoring_mode = 'executive_golf',
        bracket_type = 'heats',
        match_duration_minutes = COALESCE(match_duration_minutes, 3)
    WHERE name = 'Executive Golf';
