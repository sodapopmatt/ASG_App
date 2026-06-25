-- Change Soccer from single_elimination to pool_bracket.
-- Soccer uses group play (2 pools, round-robin) followed by a seeded knockout bracket.

UPDATE sports
SET bracket_type = 'pool_bracket'
WHERE name = 'Soccer';
