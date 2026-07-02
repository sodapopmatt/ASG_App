-- sports.advance_per_pool: how many teams from each pool advance to the
-- pool_bracket elimination phase. NULL = use the app default (2 per pool),
-- except Pickleball, which defaults to 1 (pool winners only; runners-up form
-- a separate consolation bracket seeded manually).
ALTER TABLE sports ADD COLUMN IF NOT EXISTS advance_per_pool INTEGER;
