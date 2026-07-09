-- ASG rulebook: 20th place and beyond all receive 2 points (floor was 0).
-- Mirrors the change in app logic (event_points._scale_points).
CREATE OR REPLACE FUNCTION asg_points(placement INTEGER)
RETURNS INTEGER AS $$
    SELECT GREATEST(2, 40 - ((placement - 1) * 2))::INTEGER;
$$ LANGUAGE sql IMMUTABLE;
