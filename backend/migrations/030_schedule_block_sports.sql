-- Optional sport scoping for schedule_blocks: NULL (default) keeps today's
-- behavior of applying to every sport; a non-null array restricts the block
-- to only those sports (e.g. two lunch blocks with different resume times
-- for different sport groups). See _attach_estimated_starts /
-- _compute_estimated_starts in app/routers/matches.py.

ALTER TABLE schedule_blocks ADD COLUMN IF NOT EXISTS sport_ids UUID[] NULL;
