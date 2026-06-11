-- Divisions: a sport's bracket can belong to a named division (e.g. "Main Gym",
-- "North Gym") when teams are split across venues. NULL = no division
-- (single-bracket sports, and the cross-division championship bracket).
ALTER TABLE brackets
  ADD COLUMN IF NOT EXISTS division TEXT;
