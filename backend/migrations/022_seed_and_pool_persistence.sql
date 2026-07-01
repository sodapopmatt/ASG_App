-- Persist admin-arranged seed order and pool grouping to the backend so they
-- are durable and consistent across devices (previously lived only in
-- frontend React state / localStorage).
--
-- teams.seed: bracket seed rank, 0 = top seed. NULL = not yet seeded.
-- teams.pool_index: manual pool-assignment override. NULL = no override (use
--   snake-distribution default). -2 = explicitly unassigned from all pools.
-- locations.pool_index: manual court-to-pool override. NULL = no override
--   (use default split). -1 = shared across all pools.
-- sports.pool_count: chosen number of pools for pool-play sports. NULL = use
--   the computed default (ceil(team_count / 8)).
ALTER TABLE teams ADD COLUMN IF NOT EXISTS seed INTEGER;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS pool_index INTEGER;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS pool_index INTEGER;
ALTER TABLE sports ADD COLUMN IF NOT EXISTS pool_count INTEGER;
