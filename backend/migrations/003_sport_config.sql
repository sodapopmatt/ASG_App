-- Add data-driven configuration columns to sports so all rules live in the DB.

ALTER TABLE sports
    ADD COLUMN scoring_direction TEXT NOT NULL DEFAULT 'high_wins'
        CHECK (scoring_direction IN ('high_wins', 'low_wins')),
    ADD COLUMN multi_team_rule TEXT NOT NULL DEFAULT 'best_placement'
        CHECK (multi_team_rule IN ('best_placement', 'average_score')),
    ADD COLUMN points_scale JSONB;

COMMENT ON COLUMN sports.scoring_direction IS
    'high_wins: higher score wins | low_wins: lower score wins (timed events like Human Pyramid)';
COMMENT ON COLUMN sports.multi_team_rule IS
    'best_placement: only the best-placing team counts (Dodgeball, Pickleball, Cornhole) | average_score: average across all teams counts (Water Ball Toss)';
COMMENT ON COLUMN sports.points_scale IS
    'JSON override for event point awards. NULL = use ASG scale (1st=40, 2nd=38, …). Format: {"1": 15, "2": 10, "default": 5}';

-- Apply non-default values to the seeded sports
UPDATE sports SET scoring_direction = 'low_wins'
    WHERE name = 'Human Pyramid';

UPDATE sports SET multi_team_rule = 'average_score'
    WHERE name = 'Water Ball Toss';

UPDATE sports SET points_scale = '{"1": 15, "2": 10, "default": 5}'::jsonb
    WHERE name = 'Canned Food Drive';
