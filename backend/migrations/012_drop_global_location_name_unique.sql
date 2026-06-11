-- The locations table predates migration 009 and carried a global UNIQUE(name)
-- constraint. Courts are sport-scoped — UNIQUE(sport_id, name) from 009 is the
-- intended rule — so drop the stale global constraint, which otherwise prevents
-- two different sports from both having a "Court 1".
ALTER TABLE locations DROP CONSTRAINT IF EXISTS locations_name_key;
