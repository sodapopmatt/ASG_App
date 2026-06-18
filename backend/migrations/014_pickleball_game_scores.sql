-- Migration 014: Add pickleball game-level scoring columns
--
-- Context:
--   Pickleball pool play requires per-match game counts and point totals to
--   compute pool tiebreakers: game wins, point differential, total points.
--   These supplement winner_id (which remains authoritative) and home_score/
--   away_score. All columns are nullable — non-pickleball sports leave them NULL.
--
-- This migration is idempotent (IF NOT EXISTS guards).
-- Run inside the Supabase SQL editor or via psql.

BEGIN;

ALTER TABLE matches
    ADD COLUMN IF NOT EXISTS home_games_won    INT,
    ADD COLUMN IF NOT EXISTS away_games_won    INT,
    ADD COLUMN IF NOT EXISTS home_points_total INT,
    ADD COLUMN IF NOT EXISTS away_points_total INT;

COMMIT;
