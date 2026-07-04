-- sports.pool_play_rounds: cap on the number of pool-play rounds generated per
-- pool, which equals the number of games each team plays in the pool stage.
-- NULL = full round robin (every team plays every other team once). A value of
-- N truncates the circle-method schedule to its first N rounds, so each team
-- plays exactly N distinct opponents (odd pool sizes sit one team out per round,
-- so those teams may play slightly fewer). Applies to any pool-play sport
-- (pool_bracket / pool_swiss). Useful when there isn't time for a full round
-- robin in a large pool (e.g. Pickleball).
ALTER TABLE sports ADD COLUMN IF NOT EXISTS pool_play_rounds INTEGER;
